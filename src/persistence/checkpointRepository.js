const logger = require('../utils/logger');

const CHECKPOINT_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused'
};

class CheckpointRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  create(syncId) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      INSERT INTO sync_checkpoints (sync_id, status, started_at, updated_at)
      VALUES (?, ?, ?, ?)
    `, [syncId, CHECKPOINT_STATUS.IN_PROGRESS, now, now]);

    // get the last inserted id
    const result = this.dbManager.queryOne(
      'SELECT id FROM sync_checkpoints WHERE sync_id = ? ORDER BY id DESC LIMIT 1',
      [syncId]
    );

    logger.debug('Checkpoint created', { syncId, id: result?.id });
    return result?.id;
  }

  findBySyncId(syncId) {
    const row = this.dbManager.queryOne(`
      SELECT * FROM sync_checkpoints WHERE sync_id = ? ORDER BY id DESC LIMIT 1
    `, [syncId]);
    return row ? this._mapRow(row) : null;
  }

  findLatestInProgress() {
    const row = this.dbManager.queryOne(`
      SELECT * FROM sync_checkpoints WHERE status = ? ORDER BY id DESC LIMIT 1
    `, [CHECKPOINT_STATUS.IN_PROGRESS]);
    return row ? this._mapRow(row) : null;
  }

  updateProgress(id, pageToken, filesProcessed) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE sync_checkpoints
      SET page_token = ?, files_processed = ?, updated_at = ?
      WHERE id = ?
    `, [pageToken, filesProcessed, now, id]);
    return 1;
  }

  markCompleted(id, filesProcessed) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE sync_checkpoints
      SET status = ?, files_processed = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `, [CHECKPOINT_STATUS.COMPLETED, filesProcessed, now, now, id]);
    return 1;
  }

  markFailed(id, errorMessage) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE sync_checkpoints
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `, [CHECKPOINT_STATUS.FAILED, errorMessage, now, id]);
    return 1;
  }

  pause(id) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE sync_checkpoints SET status = ?, updated_at = ? WHERE id = ?
    `, [CHECKPOINT_STATUS.PAUSED, now, id]);
    return 1;
  }

  resume(id) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE sync_checkpoints SET status = ?, updated_at = ? WHERE id = ?
    `, [CHECKPOINT_STATUS.IN_PROGRESS, now, id]);
    return 1;
  }

  delete(syncId) {
    const checkpoint = this.findBySyncId(syncId);
    if (!checkpoint) {
      return false;
    }
    this.dbManager.run(`
      DELETE FROM sync_checkpoints WHERE sync_id = ?
    `, [syncId]);
    logger.debug('Checkpoint deleted', { syncId });
    return true;
  }

  getHistory(limit = 20) {
    const rows = this.dbManager.query(`
      SELECT * FROM sync_checkpoints ORDER BY id DESC LIMIT ?
    `, [limit]);
    return rows.map(r => this._mapRow(r));
  }

  _mapRow(row) {
    return {
      id: row.id,
      syncId: row.sync_id,
      pageToken: row.page_token,
      filesProcessed: row.files_processed,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message
    };
  }
}

module.exports = { CheckpointRepository, CHECKPOINT_STATUS };
