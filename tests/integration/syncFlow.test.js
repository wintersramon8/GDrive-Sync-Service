const { createTestDb } = require('../helpers/testDb');
const { FileRepository, JobRepository, CheckpointRepository } = require('../../src/persistence');
const { JobRunner, JOB_TYPES, createFullSyncHandler } = require('../../src/jobs');
const { SyncEngine } = require('../../src/sync');

describe('Sync Flow Integration', () => {
  let dbManager;
  let fileRepo;
  let jobRepo;
  let checkpointRepo;
  let jobRunner;
  let syncEngine;
  let mockDriveClient;

  beforeEach(async () => {
    dbManager = await createTestDb();

    fileRepo = new FileRepository(dbManager);
    jobRepo = new JobRepository(dbManager);
    checkpointRepo = new CheckpointRepository(dbManager);

    mockDriveClient = {
      listFiles: jest.fn(),
      getStartPageToken: jest.fn().mockResolvedValue('initial_token')
    };

    jobRunner = new JobRunner(jobRepo);
    jobRunner.registerHandler(
      JOB_TYPES.FULL_SYNC,
      createFullSyncHandler(mockDriveClient, fileRepo, checkpointRepo, jobRepo)
    );

    syncEngine = new SyncEngine({
      driveClient: mockDriveClient,
      fileRepository: fileRepo,
      checkpointRepository: checkpointRepo,
      jobRepository: jobRepo,
      jobRunner: jobRunner
    });
  });

  afterEach(() => {
    jobRunner.stop();
    dbManager.close();
  });

  describe('full sync', () => {
    it('should sync all files from Drive', async () => {
      mockDriveClient.listFiles
        .mockResolvedValueOnce({
          data: {
            files: [
              { id: 'f1', name: 'file1.txt' },
              { id: 'f2', name: 'file2.txt' }
            ],
            nextPageToken: 'page2'
          }
        })
        .mockResolvedValueOnce({
          data: {
            files: [
              { id: 'f3', name: 'file3.txt' }
            ],
            nextPageToken: null
          }
        });

      const { syncId } = await syncEngine.startFullSync();
      jobRunner.start();

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(fileRepo.count()).toBe(3);
      expect(fileRepo.findById('f1').name).toBe('file1.txt');
      expect(fileRepo.findById('f3').name).toBe('file3.txt');

      const checkpoint = checkpointRepo.findBySyncId(syncId);
      expect(checkpoint.status).toBe('completed');
      expect(checkpoint.filesProcessed).toBe(3);
    });

    it('should be idempotent - resyncing same files updates them', async () => {
      mockDriveClient.listFiles.mockResolvedValueOnce({
        data: {
          files: [{ id: 'f1', name: 'original.txt' }],
          nextPageToken: null
        }
      });

      await syncEngine.startFullSync();
      jobRunner.start();
      await new Promise(r => setTimeout(r, 500));

      mockDriveClient.listFiles.mockResolvedValueOnce({
        data: {
          files: [{ id: 'f1', name: 'updated.txt' }],
          nextPageToken: null
        }
      });

      await syncEngine.startFullSync();
      await new Promise(r => setTimeout(r, 500));

      expect(fileRepo.count()).toBe(1);
      expect(fileRepo.findById('f1').name).toBe('updated.txt');
    });
  });

  describe('failure handling', () => {
    it('should retry on transient failures', async () => {
      let attempts = 0;
      mockDriveClient.listFiles.mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          data: {
            files: [{ id: 'f1', name: 'success.txt' }],
            nextPageToken: null
          }
        });
      });

      await syncEngine.startFullSync();
      jobRunner.start();

      await new Promise(r => setTimeout(r, 5000));

      expect(fileRepo.count()).toBe(1);
    });

    it('should move job to dead letter after max retries', async () => {
      mockDriveClient.listFiles.mockRejectedValue(new Error('Permanent failure'));

      const { jobId } = await syncEngine.startFullSync();

      dbManager.run('UPDATE jobs SET max_attempts = 2 WHERE id = ?', [jobId]);

      jobRunner.start();
      await new Promise(r => setTimeout(r, 3000));

      const deadJobs = jobRepo.getDeadLetterJobs();
      expect(deadJobs.length).toBeGreaterThan(0);
    });
  });

  describe('resumable sync', () => {
    it('should save checkpoint for resumption', async () => {
      mockDriveClient.listFiles.mockResolvedValueOnce({
        data: {
          files: [{ id: 'f1', name: 'file1.txt' }],
          nextPageToken: 'next_page_token'
        }
      }).mockResolvedValueOnce({
        data: {
          files: [{ id: 'f2', name: 'file2.txt' }],
          nextPageToken: null
        }
      });

      const { syncId } = await syncEngine.startFullSync();
      jobRunner.start();

      await new Promise(r => setTimeout(r, 500));

      const checkpoint = checkpointRepo.findBySyncId(syncId);
      expect(checkpoint.status).toBe('completed');
      expect(checkpoint.filesProcessed).toBe(2);
    });
  });
});
