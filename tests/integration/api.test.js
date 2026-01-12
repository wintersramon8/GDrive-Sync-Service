const request = require('supertest');
const express = require('express');
const { createTestDb } = require('../helpers/testDb');

const { FileRepository, JobRepository } = require('../../src/persistence');
const { createFilesRouter, createJobsRouter } = require('../../src/routes');
const { JobRunner } = require('../../src/jobs');

describe('API Integration', () => {
  let app;
  let dbManager;
  let fileRepo;
  let jobRepo;
  let jobRunner;

  beforeEach(async () => {
    dbManager = await createTestDb();

    fileRepo = new FileRepository(dbManager);
    jobRepo = new JobRepository(dbManager);
    jobRunner = new JobRunner(jobRepo);

    app = express();
    app.use(express.json());
    app.use('/files', createFilesRouter(fileRepo));
    app.use('/jobs', createJobsRouter(jobRunner, jobRepo));
  });

  afterEach(() => {
    jobRunner.stop();
    dbManager.close();
  });

  describe('GET /files', () => {
    it('should return paginated files', async () => {
      fileRepo.upsertBatch([
        { id: 'f1', name: 'file1.txt' },
        { id: 'f2', name: 'file2.txt' },
        { id: 'f3', name: 'file3.txt' }
      ]);

      const response = await request(app)
        .get('/files?limit=2&offset=0')
        .expect(200);

      expect(response.body.files.length).toBe(2);
      expect(response.body.pagination.total).toBe(3);
      expect(response.body.pagination.hasMore).toBe(true);
    });

    it('should return file count', async () => {
      fileRepo.upsertBatch([
        { id: 'f1', name: 'file1.txt' },
        { id: 'f2', name: 'file2.txt' }
      ]);

      const response = await request(app)
        .get('/files/count')
        .expect(200);

      expect(response.body.count).toBe(2);
    });
  });

  describe('GET /files/:id', () => {
    it('should return a specific file', async () => {
      fileRepo.upsert({ id: 'file123', name: 'myfile.txt', mimeType: 'text/plain' });

      const response = await request(app)
        .get('/files/file123')
        .expect(200);

      expect(response.body.id).toBe('file123');
      expect(response.body.name).toBe('myfile.txt');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await request(app)
        .get('/files/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('File not found');
    });
  });

  describe('GET /jobs/stats', () => {
    it('should return job statistics', async () => {
      jobRepo.create('test', {});
      jobRepo.create('test', {});

      const response = await request(app)
        .get('/jobs/stats')
        .expect(200);

      expect(response.body.pending).toBe(2);
    });
  });

  describe('POST /jobs/:id/retry', () => {
    it('should reschedule a failed job', async () => {
      const id = jobRepo.create('test', {});
      jobRepo.markRunning(id);
      jobRepo.markFailed(id, 'Some error');

      const response = await request(app)
        .post(`/jobs/${id}/retry`)
        .expect(200);

      const job = jobRepo.findById(id);
      expect(job.status).toBe('pending');
    });

    it('should return 404 for non-existent job', async () => {
      await request(app)
        .post('/jobs/nonexistent/retry')
        .expect(404);
    });
  });

  describe('job runner control', () => {
    it('should pause and resume job runner', async () => {
      jobRunner.start();

      await request(app)
        .post('/jobs/runner/pause')
        .expect(200);

      let stats = jobRunner.getStats();
      expect(stats.paused).toBe(true);

      await request(app)
        .post('/jobs/runner/resume')
        .expect(200);

      stats = jobRunner.getStats();
      expect(stats.paused).toBe(false);
    });

    it('should update concurrency', async () => {
      await request(app)
        .post('/jobs/runner/concurrency')
        .send({ concurrency: 5 })
        .expect(200);

      const stats = jobRunner.getStats();
      expect(stats.concurrency).toBe(5);
    });
  });
});
