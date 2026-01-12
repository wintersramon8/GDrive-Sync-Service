const { createTestDb } = require('../helpers/testDb');
const JobRunner = require('../../src/jobs/jobRunner');
const { JobRepository } = require('../../src/persistence/jobRepository');

describe('JobRunner', () => {
  let dbManager;
  let jobRepo;
  let runner;

  beforeEach(async () => {
    dbManager = await createTestDb();
    jobRepo = new JobRepository(dbManager);
    runner = new JobRunner(jobRepo);
  });

  afterEach(() => {
    runner.stop();
    dbManager.close();
  });

  describe('registerHandler', () => {
    it('should register a job handler', () => {
      const handler = jest.fn();
      runner.registerHandler('test', handler);

      expect(runner.handlers['test']).toBe(handler);
    });
  });

  describe('job processing', () => {
    it('should process a job with the correct handler', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      runner.registerHandler('test_job', handler);

      const jobId = jobRepo.create('test_job', { data: 'test' });

      runner.start();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(handler).toHaveBeenCalled();
      const job = jobRepo.findById(jobId);
      expect(job.status).toBe('completed');
    });

    it('should retry failed jobs', async () => {
      let callCount = 0;
      const handler = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Temporary failure');
        }
        return { success: true };
      });

      runner.registerHandler('retry_test', handler);
      jobRepo.create('retry_test', {}, { maxAttempts: 5 });

      runner.start();

      await new Promise(resolve => setTimeout(resolve, 5000));

      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should emit events on job completion', async () => {
      const handler = jest.fn().mockResolvedValue({ done: true });
      runner.registerHandler('event_test', handler);

      const completedFn = jest.fn();
      runner.on('job:completed', completedFn);

      jobRepo.create('event_test', {});
      runner.start();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(completedFn).toHaveBeenCalled();
    });
  });

  describe('concurrency control', () => {
    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const handler = jest.fn().mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 100));
        concurrent--;
        return {};
      });

      runner.registerHandler('concurrent_test', handler);
      runner.setConcurrency(2);

      for (let i = 0; i < 10; i++) {
        jobRepo.create('concurrent_test', {});
      }

      runner.start();
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('pause and resume', () => {
    it('should pause job processing', async () => {
      const handler = jest.fn().mockResolvedValue({});
      runner.registerHandler('pause_test', handler);

      runner.start();
      runner.pause();

      jobRepo.create('pause_test', {});
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should resume job processing', async () => {
      const handler = jest.fn().mockResolvedValue({});
      runner.registerHandler('resume_test', handler);

      jobRepo.create('resume_test', {});

      runner.start();
      runner.pause();

      await new Promise(resolve => setTimeout(resolve, 100));

      runner.resume();
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(handler).toHaveBeenCalled();
    });
  });
});
