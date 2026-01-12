const { createTestDb } = require('../helpers/testDb');
const { JobRepository, JOB_STATUS } = require('../../src/persistence/jobRepository');

describe('JobRepository', () => {
  let dbManager;
  let repo;

  beforeEach(async () => {
    dbManager = await createTestDb();
    repo = new JobRepository(dbManager);
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('create', () => {
    it('should create a new job', () => {
      const id = repo.create('sync', { syncId: 'test123' });

      expect(id).toBeDefined();
      const job = repo.findById(id);
      expect(job.type).toBe('sync');
      expect(job.status).toBe(JOB_STATUS.PENDING);
      expect(job.payload.syncId).toBe('test123');
    });

    it('should respect priority option', () => {
      const id = repo.create('sync', {}, { priority: 10 });

      const job = repo.findById(id);
      expect(job.priority).toBe(10);
    });
  });

  describe('findPendingJobs', () => {
    it('should return pending jobs ordered by priority', () => {
      repo.create('low', {}, { priority: 1 });
      repo.create('high', {}, { priority: 10 });
      repo.create('medium', {}, { priority: 5 });

      const jobs = repo.findPendingJobs(10);

      expect(jobs[0].type).toBe('high');
      expect(jobs[1].type).toBe('medium');
      expect(jobs[2].type).toBe('low');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        repo.create('test', {});
      }

      const jobs = repo.findPendingJobs(5);
      expect(jobs.length).toBe(5);
    });
  });

  describe('state transitions', () => {
    it('should mark job as running', () => {
      const id = repo.create('test', {});

      repo.markRunning(id);

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.RUNNING);
      expect(job.attempts).toBe(1);
      expect(job.startedAt).toBeDefined();
    });

    it('should mark job as completed', () => {
      const id = repo.create('test', {});
      repo.markRunning(id);

      repo.markCompleted(id);

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.COMPLETED);
      expect(job.completedAt).toBeDefined();
    });

    it('should mark job as failed with error', () => {
      const id = repo.create('test', {});
      repo.markRunning(id);

      repo.markFailed(id, 'Something went wrong');

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.FAILED);
      expect(job.lastError).toBe('Something went wrong');
    });
  });

  describe('reschedule', () => {
    it('should reschedule a failed job', () => {
      const id = repo.create('test', {});
      repo.markFailed(id, 'error');

      repo.reschedule(id, 5000);

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.PENDING);
    });
  });

  describe('dead letter queue', () => {
    it('should move job to dead letter after max attempts', () => {
      const id = repo.create('test', {}, { maxAttempts: 1 });
      repo.markRunning(id);

      repo.markFailed(id, 'Final failure');

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.DEAD);

      const deadJobs = repo.getDeadLetterJobs();
      expect(deadJobs.length).toBe(1);
      expect(deadJobs[0].job_id).toBe(id);
    });

    it('should retry a dead letter job', () => {
      const id = repo.create('test', {}, { maxAttempts: 1 });
      repo.markRunning(id);
      repo.markFailed(id, 'Final failure');

      const deadJobs = repo.getDeadLetterJobs();
      repo.retryDeadJob(deadJobs[0].id);

      const job = repo.findById(id);
      expect(job.status).toBe(JOB_STATUS.PENDING);
      expect(job.attempts).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return job statistics', () => {
      repo.create('a', {});
      repo.create('b', {});
      const id = repo.create('c', {});
      repo.markRunning(id);
      repo.markCompleted(id);

      const stats = repo.getStats();

      expect(stats.pending).toBe(2);
      expect(stats.completed).toBe(1);
    });
  });
});
