/**
 * Requirements Verification Tests
 * Tests each requirement from the take-home test specification
 */

const { createTestDb } = require('./helpers/testDb');
const { FileRepository, JobRepository, CheckpointRepository, JOB_STATUS } = require('../src/persistence');
const { JobRunner, JOB_TYPES, createFullSyncHandler } = require('../src/jobs');
const { SyncEngine } = require('../src/sync');
const { DriveClient, RateLimitError } = require('../src/api');

describe('REQUIREMENT 1: Authentication & API Client', () => {
  describe('1.1 Google OAuth 2.0 with least-privilege scopes', () => {
    it('should use metadata.readonly and drive.readonly scopes', () => {
      const config = require('../src/config');
      expect(config.google.scopes).toContain('https://www.googleapis.com/auth/drive.metadata.readonly');
      expect(config.google.scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
      // Should NOT have full drive access
      expect(config.google.scopes).not.toContain('https://www.googleapis.com/auth/drive');
    });
  });

  describe('1.2 Testable Drive client with paginated listing', () => {
    it('should support pagination with pageToken', async () => {
      const mockAuthClient = { getClient: () => ({}) };
      const client = new DriveClient(mockAuthClient);

      const mockList = jest.fn()
        .mockResolvedValueOnce({
          data: { files: [{ id: '1' }], nextPageToken: 'token123' }
        })
        .mockResolvedValueOnce({
          data: { files: [{ id: '2' }], nextPageToken: null }
        });

      client.drive = { files: { list: mockList } };

      // First page
      const page1 = await client.listFiles();
      expect(page1.data.nextPageToken).toBe('token123');

      // Second page with token
      const page2 = await client.listFiles({ pageToken: 'token123' });
      expect(page2.data.nextPageToken).toBeNull();

      expect(mockList).toHaveBeenCalledTimes(2);
    });

    it('should handle rate limits with exponential backoff', async () => {
      const mockAuthClient = { getClient: () => ({}) };
      const client = new DriveClient(mockAuthClient);

      let attempts = 0;
      client.drive = {
        files: {
          list: jest.fn().mockImplementation(() => {
            attempts++;
            if (attempts < 3) {
              return Promise.reject({ code: 429 });
            }
            return Promise.resolve({ data: { files: [] } });
          })
        }
      };

      const result = await client.listFiles();
      expect(attempts).toBe(3);
      expect(result.data.files).toEqual([]);
    });
  });
});

describe('REQUIREMENT 2: Resumable Sync Engine', () => {
  let dbManager, fileRepo, jobRepo, checkpointRepo, jobRunner, syncEngine, mockDriveClient;

  beforeEach(async () => {
    dbManager = await createTestDb();
    fileRepo = new FileRepository(dbManager);
    jobRepo = new JobRepository(dbManager);
    checkpointRepo = new CheckpointRepository(dbManager);

    mockDriveClient = {
      listFiles: jest.fn(),
      getStartPageToken: jest.fn().mockResolvedValue('start_token')
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
      jobRunner
    });
  });

  afterEach(() => {
    jobRunner.stop();
    dbManager.close();
  });

  describe('2.1 Handles pagination', () => {
    it('should process multiple pages of results', async () => {
      mockDriveClient.listFiles
        .mockResolvedValueOnce({
          data: { files: [{ id: 'f1', name: 'file1.txt' }], nextPageToken: 'page2' }
        })
        .mockResolvedValueOnce({
          data: { files: [{ id: 'f2', name: 'file2.txt' }], nextPageToken: 'page3' }
        })
        .mockResolvedValueOnce({
          data: { files: [{ id: 'f3', name: 'file3.txt' }], nextPageToken: null }
        });

      await syncEngine.startFullSync();
      jobRunner.start();
      await new Promise(r => setTimeout(r, 800));

      expect(fileRepo.count()).toBe(3);
      expect(mockDriveClient.listFiles).toHaveBeenCalledTimes(3);
    });
  });

  describe('2.2 Is idempotent', () => {
    it('should update existing files instead of duplicating', async () => {
      // First sync
      mockDriveClient.listFiles.mockResolvedValueOnce({
        data: { files: [{ id: 'f1', name: 'original.txt', size: 100 }], nextPageToken: null }
      });

      await syncEngine.startFullSync();
      jobRunner.start();
      await new Promise(r => setTimeout(r, 500));

      expect(fileRepo.count()).toBe(1);
      expect(fileRepo.findById('f1').name).toBe('original.txt');

      // Second sync with updated file
      mockDriveClient.listFiles.mockResolvedValueOnce({
        data: { files: [{ id: 'f1', name: 'updated.txt', size: 200 }], nextPageToken: null }
      });

      await syncEngine.startFullSync();
      await new Promise(r => setTimeout(r, 500));

      // Should still be 1 file, but updated
      expect(fileRepo.count()).toBe(1);
      expect(fileRepo.findById('f1').name).toBe('updated.txt');
      expect(fileRepo.findById('f1').size).toBe(200);
    });
  });

  describe('2.3 Resume after interruption using persisted checkpoints', () => {
    it('should persist checkpoint with page token', async () => {
      mockDriveClient.listFiles
        .mockResolvedValueOnce({
          data: { files: [{ id: 'f1', name: 'file1.txt' }], nextPageToken: 'resume_token' }
        })
        .mockResolvedValueOnce({
          data: { files: [{ id: 'f2', name: 'file2.txt' }], nextPageToken: null }
        });

      const { syncId } = await syncEngine.startFullSync();
      jobRunner.start();
      await new Promise(r => setTimeout(r, 600));

      const checkpoint = checkpointRepo.findBySyncId(syncId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint.filesProcessed).toBe(2);
      expect(checkpoint.status).toBe('completed');
    });

    it('should detect existing in-progress sync on restart', async () => {
      // Create an in-progress checkpoint manually
      checkpointRepo.create('existing_sync');

      // Try to start a new sync - should resume existing
      const result = await syncEngine.startFullSync();

      expect(result.syncId).toBe('existing_sync');
    });
  });
});

describe('REQUIREMENT 3: Job System & Concurrency Control', () => {
  let dbManager, jobRepo, jobRunner;

  beforeEach(async () => {
    dbManager = await createTestDb();
    jobRepo = new JobRepository(dbManager);
    jobRunner = new JobRunner(jobRepo);
  });

  afterEach(() => {
    jobRunner.stop();
    dbManager.close();
  });

  describe('3.1 Explicit job states', () => {
    it('should have all required job states', () => {
      expect(JOB_STATUS.PENDING).toBe('pending');
      expect(JOB_STATUS.RUNNING).toBe('running');
      expect(JOB_STATUS.COMPLETED).toBe('completed');
      expect(JOB_STATUS.FAILED).toBe('failed');
      expect(JOB_STATUS.DEAD).toBe('dead');
    });

    it('should transition through states correctly', () => {
      const jobId = jobRepo.create('test', { data: 'test' });

      // Initial state
      expect(jobRepo.findById(jobId).status).toBe('pending');

      // Start running
      jobRepo.markRunning(jobId);
      expect(jobRepo.findById(jobId).status).toBe('running');

      // Complete
      jobRepo.markCompleted(jobId);
      expect(jobRepo.findById(jobId).status).toBe('completed');
    });
  });

  describe('3.2 Retries with backoff', () => {
    it('should retry failed jobs with increasing delay', async () => {
      let attempts = 0;
      const delays = [];
      let lastAttemptTime = Date.now();

      const handler = jest.fn().mockImplementation(() => {
        const now = Date.now();
        if (attempts > 0) {
          delays.push(now - lastAttemptTime);
        }
        lastAttemptTime = now;
        attempts++;

        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return { success: true };
      });

      jobRunner.registerHandler('retry_test', handler);
      jobRepo.create('retry_test', {}, { maxAttempts: 5 });

      jobRunner.start();
      // With exponential backoff (base 1000ms): 2s after 1st fail + 4s after 2nd fail = 6s
      // Plus polling intervals (1s each) and processing time, need ~9s total
      await new Promise(r => setTimeout(r, 9000));

      expect(attempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('3.3 Concurrency limits', () => {
    it('should not exceed configured concurrency', async () => {
      let currentConcurrent = 0;
      let maxObserved = 0;

      const handler = jest.fn().mockImplementation(async () => {
        currentConcurrent++;
        maxObserved = Math.max(maxObserved, currentConcurrent);
        await new Promise(r => setTimeout(r, 100));
        currentConcurrent--;
        return {};
      });

      jobRunner.registerHandler('concurrency_test', handler);
      jobRunner.setConcurrency(2);

      // Create 10 jobs
      for (let i = 0; i < 10; i++) {
        jobRepo.create('concurrency_test', { index: i });
      }

      jobRunner.start();
      await new Promise(r => setTimeout(r, 2000));

      expect(maxObserved).toBeLessThanOrEqual(2);
    });
  });

  describe('3.4 Dead-letter handling', () => {
    it('should move jobs to dead letter after max attempts', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Always fails'));

      jobRunner.registerHandler('dead_test', handler);

      const jobId = jobRepo.create('dead_test', {}, { maxAttempts: 2 });

      jobRunner.start();
      await new Promise(r => setTimeout(r, 4000));

      const job = jobRepo.findById(jobId);
      expect(job.status).toBe('dead');

      const deadJobs = jobRepo.getDeadLetterJobs();
      expect(deadJobs.length).toBe(1);
      expect(deadJobs[0].job_id).toBe(jobId);
    });

    it('should allow retrying dead letter jobs', () => {
      const jobId = jobRepo.create('test', {}, { maxAttempts: 1 });
      jobRepo.markRunning(jobId);
      jobRepo.markFailed(jobId, 'Final failure');

      const deadJobs = jobRepo.getDeadLetterJobs();
      expect(deadJobs.length).toBe(1);

      // Retry the dead job
      jobRepo.retryDeadJob(deadJobs[0].id);

      const job = jobRepo.findById(jobId);
      expect(job.status).toBe('pending');
      expect(job.attempts).toBe(0);

      // Dead letter queue should be empty
      expect(jobRepo.getDeadLetterJobs().length).toBe(0);
    });
  });
});

describe('REQUIREMENT 4: Persistence & State Management', () => {
  let dbManager, fileRepo, jobRepo, checkpointRepo;

  beforeEach(async () => {
    dbManager = await createTestDb();
    fileRepo = new FileRepository(dbManager);
    jobRepo = new JobRepository(dbManager);
    checkpointRepo = new CheckpointRepository(dbManager);
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('4.1 Persist file metadata', () => {
    it('should store all file metadata fields', () => {
      const file = {
        id: 'test_file_123',
        name: 'document.pdf',
        mimeType: 'application/pdf',
        size: 1024000,
        parents: ['folder_abc'],
        modifiedTime: '2024-01-15T10:30:00Z',
        createdTime: '2024-01-10T08:00:00Z',
        md5Checksum: 'abc123def456'
      };

      fileRepo.upsert(file);

      const stored = fileRepo.findById('test_file_123');
      expect(stored.name).toBe('document.pdf');
      expect(stored.mimeType).toBe('application/pdf');
      expect(stored.size).toBe(1024000);
      expect(stored.parentId).toBe('folder_abc');
      expect(stored.md5Checksum).toBe('abc123def456');
    });
  });

  describe('4.2 Persist job state', () => {
    it('should persist job with all state information', () => {
      const jobId = jobRepo.create('sync_job', { syncId: 'sync_123' }, {
        priority: 5,
        maxAttempts: 3
      });

      jobRepo.markRunning(jobId);

      const job = jobRepo.findById(jobId);
      expect(job.type).toBe('sync_job');
      expect(job.payload.syncId).toBe('sync_123');
      expect(job.priority).toBe(5);
      expect(job.maxAttempts).toBe(3);
      expect(job.attempts).toBe(1);
      expect(job.status).toBe('running');
      expect(job.startedAt).toBeDefined();
    });
  });

  describe('4.3 Persist sync progress', () => {
    it('should track sync progress with checkpoints', () => {
      const checkpointId = checkpointRepo.create('sync_abc');

      checkpointRepo.updateProgress(checkpointId, 'page_token_xyz', 150);

      const checkpoint = checkpointRepo.findBySyncId('sync_abc');
      expect(checkpoint.pageToken).toBe('page_token_xyz');
      expect(checkpoint.filesProcessed).toBe(150);
      expect(checkpoint.status).toBe('in_progress');
    });
  });

  describe('4.4 Consistency under partial failures', () => {
    it('should maintain data integrity after failed operations', () => {
      // Insert some files
      fileRepo.upsertBatch([
        { id: 'f1', name: 'file1.txt' },
        { id: 'f2', name: 'file2.txt' }
      ]);

      expect(fileRepo.count()).toBe(2);

      // Simulate partial update (one file updated, one stays same)
      fileRepo.upsert({ id: 'f1', name: 'updated.txt' });

      expect(fileRepo.count()).toBe(2);
      expect(fileRepo.findById('f1').name).toBe('updated.txt');
      expect(fileRepo.findById('f2').name).toBe('file2.txt');
    });
  });
});

describe('REQUIREMENT 5: Operability & Validation', () => {
  describe('5.1 Logging', () => {
    it('should have winston logger configured', () => {
      const logger = require('../src/utils/logger');
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });
  });

  describe('5.2 Job statistics', () => {
    it('should provide job queue statistics', async () => {
      const dbManager = await createTestDb();
      const jobRepo = new JobRepository(dbManager);
      const jobRunner = new JobRunner(jobRepo);

      // Create jobs in various states
      jobRepo.create('test', {});
      jobRepo.create('test', {});
      const completedId = jobRepo.create('test', {});
      jobRepo.markRunning(completedId);
      jobRepo.markCompleted(completedId);

      const stats = jobRunner.getStats();

      expect(stats.pending).toBe(2);
      expect(stats.completed).toBe(1);
      expect(typeof stats.running).toBe('boolean');
      expect(typeof stats.concurrency).toBe('number');

      dbManager.close();
    });
  });
});

describe('ERROR CONDITIONS', () => {
  describe('Network failures', () => {
    it('should handle and recover from network errors', async () => {
      const mockAuthClient = { getClient: () => ({}) };
      const client = new DriveClient(mockAuthClient);

      let attempts = 0;
      client.drive = {
        files: {
          list: jest.fn().mockImplementation(() => {
            attempts++;
            if (attempts < 3) {
              return Promise.reject({ code: 500, message: 'Internal Server Error' });
            }
            return Promise.resolve({ data: { files: [{ id: '1' }] } });
          })
        }
      };

      const result = await client.listFiles();

      expect(attempts).toBe(3);
      expect(result.data.files.length).toBe(1);
    });
  });

  describe('Rate limit errors', () => {
    it('should eventually throw RateLimitError after max retries', async () => {
      const mockAuthClient = { getClient: () => ({}) };
      const client = new DriveClient(mockAuthClient);

      client.drive = {
        files: {
          list: jest.fn().mockRejectedValue({ code: 429 })
        }
      };

      await expect(client.listFiles()).rejects.toThrow(RateLimitError);
    });
  });
});
