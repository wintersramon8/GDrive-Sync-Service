const logger = require('../utils/logger');

function generateId() {
  return 'job_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead'
};

class JobRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  create(type, payload, options = {}) {
    const id = generateId();
    const now = new Date().toISOString();

    this.dbManager.run(`
      INSERT INTO jobs (id, type, payload, status, priority, max_attempts, created_at, updated_at, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      type,
      JSON.stringify(payload),
      JOB_STATUS.PENDING,
      options.priority || 0,
      options.maxAttempts || 5,
      now,
      now,
      options.scheduledAt || now
    ]);

    logger.debug('Job created', { id, type });
    return id;
  }

  findById(id) {
    const row = this.dbManager.queryOne('SELECT * FROM jobs WHERE id = ?', [id]);
    return row ? this._mapRow(row) : null;
  }

  findPendingJobs(limit = 10) {
    const now = new Date().toISOString();
    const rows = this.dbManager.query(`
      SELECT * FROM jobs
      WHERE status = ? AND scheduled_at <= ?
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `, [JOB_STATUS.PENDING, now, limit]);
    return rows.map(r => this._mapRow(r));
  }

  findByStatus(status, limit = 100) {
    const rows = this.dbManager.query(
      'SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit]
    );
    return rows.map(r => this._mapRow(r));
  }

  markRunning(id) {
    const now = new Date().toISOString();
    const job = this.findById(id);
    if (!job) return 0;

    this.dbManager.run(`
      UPDATE jobs SET status = ?, started_at = ?, updated_at = ?, attempts = ?
      WHERE id = ?
    `, [JOB_STATUS.RUNNING, now, now, job.attempts + 1, id]);
    return 1;
  }

  markCompleted(id) {
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE jobs SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `, [JOB_STATUS.COMPLETED, now, now, id]);
    return 1;
  }

  markFailed(id, error) {
    const now = new Date().toISOString();
    const job = this.findById(id);

    if (job && job.attempts >= job.maxAttempts) {
      return this.moveToDead(id, error);
    }

    this.dbManager.run(`
      UPDATE jobs SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `, [JOB_STATUS.FAILED, error, now, id]);
    return 1;
  }

  reschedule(id, delayMs) {
    const scheduledAt = new Date(Date.now() + delayMs).toISOString();
    const now = new Date().toISOString();
    this.dbManager.run(`
      UPDATE jobs SET status = ?, scheduled_at = ?, updated_at = ?
      WHERE id = ?
    `, [JOB_STATUS.PENDING, scheduledAt, now, id]);
    return 1;
  }

  moveToDead(id, error) {
    const job = this.findById(id);
    if (!job) return 0;

    const now = new Date().toISOString();

    this.dbManager.run(`
      INSERT INTO dead_letter_queue (job_id, job_type, payload, error_message, failed_at)
      VALUES (?, ?, ?, ?, ?)
    `, [job.id, job.type, JSON.stringify(job.payload), error, now]);

    this.dbManager.run(`
      UPDATE jobs SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `, [JOB_STATUS.DEAD, error, now, id]);

    logger.warn('Job moved to dead letter queue', { id, type: job.type, error });
    return 1;
  }

  getDeadLetterJobs(limit = 100) {
    return this.dbManager.query(
      'SELECT * FROM dead_letter_queue ORDER BY failed_at DESC LIMIT ?',
      [limit]
    );
  }

  retryDeadJob(deadId) {
    const deadJob = this.dbManager.queryOne(
      'SELECT * FROM dead_letter_queue WHERE id = ?',
      [deadId]
    );
    if (!deadJob) return null;

    const originalJob = this.findById(deadJob.job_id);
    if (!originalJob) return null;

    const now = new Date().toISOString();

    this.dbManager.run('DELETE FROM dead_letter_queue WHERE id = ?', [deadId]);
    this.dbManager.run(`
      UPDATE jobs SET status = ?, attempts = 0, last_error = NULL, updated_at = ?, scheduled_at = ?
      WHERE id = ?
    `, [JOB_STATUS.PENDING, now, now, deadJob.job_id]);

    logger.info('Dead job requeued', { jobId: deadJob.job_id });
    return deadJob.job_id;
  }

  getStats() {
    const rows = this.dbManager.query(
      'SELECT status, COUNT(*) as count FROM jobs GROUP BY status',
      []
    );
    const stats = {};
    for (const row of rows) {
      stats[row.status] = row.count;
    }

    const deadCount = this.dbManager.queryOne(
      'SELECT COUNT(*) as count FROM dead_letter_queue',
      []
    );
    stats.deadLetter = deadCount ? deadCount.count : 0;

    return stats;
  }

  _mapRow(row) {
    return {
      id: row.id,
      type: row.type,
      payload: row.payload ? JSON.parse(row.payload) : null,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      completedAt: row.completed_at
    };
  }
}

module.exports = { JobRepository, JOB_STATUS };
