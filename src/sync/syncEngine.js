const EventEmitter = require('events');
const logger = require('../utils/logger');
const { CHECKPOINT_STATUS } = require('../persistence');
const { JOB_TYPES } = require('../jobs');

function generateSyncId() {
  return 'sync_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

class SyncEngine extends EventEmitter {
  constructor(options) {
    super();
    this.driveClient = options.driveClient;
    this.fileRepo = options.fileRepository;
    this.checkpointRepo = options.checkpointRepository;
    this.jobRepo = options.jobRepository;
    this.jobRunner = options.jobRunner;

    this.currentSyncId = null;
    this.lastChangeToken = null;
  }

  async startFullSync() {
    // check for existing in-progress sync
    const existing = this.checkpointRepo.findLatestInProgress();
    if (existing) {
      logger.info('Found existing sync in progress, resuming', { syncId: existing.syncId });
      return this.resumeSync(existing.syncId);
    }

    const syncId = generateSyncId();
    this.currentSyncId = syncId;

    this.checkpointRepo.create(syncId);

    const jobId = this.jobRepo.create(JOB_TYPES.FULL_SYNC, { syncId }, {
      priority: 10,
      maxAttempts: 3
    });

    logger.info('Full sync initiated', { syncId, jobId });
    this.emit('sync:started', { syncId, type: 'full' });

    return { syncId, jobId };
  }

  async startIncrementalSync() {
    if (!this.lastChangeToken) {
      // first time, need to get initial token
      this.lastChangeToken = await this.driveClient.getStartPageToken();
      logger.info('Got initial change token', { token: this.lastChangeToken });
    }

    const syncId = generateSyncId();
    this.currentSyncId = syncId;

    this.checkpointRepo.create(syncId);

    const jobId = this.jobRepo.create(JOB_TYPES.INCREMENTAL_SYNC, {
      syncId,
      startPageToken: this.lastChangeToken
    }, {
      priority: 5,
      maxAttempts: 3
    });

    logger.info('Incremental sync initiated', { syncId, jobId });
    this.emit('sync:started', { syncId, type: 'incremental' });

    return { syncId, jobId };
  }

  async resumeSync(syncId) {
    const checkpoint = this.checkpointRepo.findBySyncId(syncId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found for sync: ${syncId}`);
    }

    if (checkpoint.status === CHECKPOINT_STATUS.COMPLETED) {
      throw new Error(`Sync ${syncId} already completed`);
    }

    this.checkpointRepo.resume(checkpoint.id);
    this.currentSyncId = syncId;

    const jobId = this.jobRepo.create(JOB_TYPES.FULL_SYNC, {
      syncId,
      resumeFrom: checkpoint.pageToken
    }, {
      priority: 10,
      maxAttempts: 3
    });

    logger.info('Sync resumed', { syncId, jobId, fromPage: !!checkpoint.pageToken });
    this.emit('sync:resumed', { syncId });

    return { syncId, jobId };
  }

  pauseSync(syncId) {
    const checkpoint = this.checkpointRepo.findBySyncId(syncId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found for sync: ${syncId}`);
    }

    this.checkpointRepo.pause(checkpoint.id);
    logger.info('Sync paused', { syncId });
    this.emit('sync:paused', { syncId });
  }

  getStatus(syncId) {
    const checkpoint = this.checkpointRepo.findBySyncId(syncId);
    if (!checkpoint) {
      return null;
    }

    return {
      syncId: checkpoint.syncId,
      status: checkpoint.status,
      filesProcessed: checkpoint.filesProcessed,
      startedAt: checkpoint.startedAt,
      updatedAt: checkpoint.updatedAt,
      completedAt: checkpoint.completedAt,
      error: checkpoint.errorMessage
    };
  }

  getCurrentSync() {
    if (!this.currentSyncId) {
      return null;
    }
    return this.getStatus(this.currentSyncId);
  }

  getSyncHistory(limit = 20) {
    return this.checkpointRepo.getHistory(limit);
  }

  deleteSync(syncId) {
    const checkpoint = this.checkpointRepo.findBySyncId(syncId);
    if (!checkpoint) {
      throw new Error(`Sync not found: ${syncId}`);
    }

    if (checkpoint.status === CHECKPOINT_STATUS.IN_PROGRESS) {
      throw new Error(`Cannot delete sync ${syncId} while it is in progress. Pause it first.`);
    }

    const deleted = this.checkpointRepo.delete(syncId);
    if (deleted) {
      logger.info('Sync deleted', { syncId });
      this.emit('sync:deleted', { syncId });

      if (this.currentSyncId === syncId) {
        this.currentSyncId = null;
      }
    }
    return deleted;
  }

  getFileCount() {
    return this.fileRepo.count();
  }

  getFiles(limit = 100, offset = 0) {
    return this.fileRepo.getAll(limit, offset);
  }

  setChangeToken(token) {
    this.lastChangeToken = token;
  }
}

module.exports = SyncEngine;
