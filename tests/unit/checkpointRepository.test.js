const { createTestDb } = require('../helpers/testDb');
const { CheckpointRepository, CHECKPOINT_STATUS } = require('../../src/persistence/checkpointRepository');

describe('CheckpointRepository', () => {
  let dbManager;
  let repo;

  beforeEach(async () => {
    dbManager = await createTestDb();
    repo = new CheckpointRepository(dbManager);
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('create', () => {
    it('should create a new checkpoint', () => {
      const id = repo.create('sync_123');

      const checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint).not.toBeNull();
      expect(checkpoint.syncId).toBe('sync_123');
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.IN_PROGRESS);
    });
  });

  describe('updateProgress', () => {
    it('should update checkpoint progress', () => {
      const id = repo.create('sync_123');

      repo.updateProgress(id, 'page_token_abc', 100);

      const checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint.pageToken).toBe('page_token_abc');
      expect(checkpoint.filesProcessed).toBe(100);
    });
  });

  describe('status transitions', () => {
    it('should mark checkpoint as completed', () => {
      const id = repo.create('sync_123');

      repo.markCompleted(id, 500);

      const checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.COMPLETED);
      expect(checkpoint.filesProcessed).toBe(500);
      expect(checkpoint.completedAt).toBeDefined();
    });

    it('should mark checkpoint as failed', () => {
      const id = repo.create('sync_123');

      repo.markFailed(id, 'Connection timeout');

      const checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.FAILED);
      expect(checkpoint.errorMessage).toBe('Connection timeout');
    });

    it('should pause and resume checkpoint', () => {
      const id = repo.create('sync_123');

      repo.pause(id);
      let checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.PAUSED);

      repo.resume(id);
      checkpoint = repo.findBySyncId('sync_123');
      expect(checkpoint.status).toBe(CHECKPOINT_STATUS.IN_PROGRESS);
    });
  });

  describe('findLatestInProgress', () => {
    it('should find the most recent in-progress sync', () => {
      repo.create('sync_1');
      const id2 = repo.create('sync_2');
      const id3 = repo.create('sync_3');
      repo.markCompleted(id3, 0);

      const checkpoint = repo.findLatestInProgress();

      expect(checkpoint.syncId).toBe('sync_2');
    });
  });

  describe('getHistory', () => {
    it('should return sync history', () => {
      repo.create('sync_1');
      repo.create('sync_2');
      repo.create('sync_3');

      const history = repo.getHistory(10);

      expect(history.length).toBe(3);
      expect(history[0].syncId).toBe('sync_3');
    });
  });
});
