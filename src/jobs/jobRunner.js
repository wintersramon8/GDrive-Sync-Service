const EventEmitter = require('events');
const logger = require('../utils/logger');
const config = require('../config');

class JobRunner extends EventEmitter {
  constructor(jobRepository, handlers = {}) {
    super();
    this.jobRepo = jobRepository;
    this.handlers = handlers;
    this.running = false;
    this.activeJobs = new Map();
    this.concurrency = config.sync.concurrency;
    this.pollInterval = 1000;
    this.pollTimer = null;
    this.paused = false;
  }

  registerHandler(type, handler) {
    this.handlers[type] = handler;
    logger.debug('Job handler registered', { type });
  }

  start() {
    if (this.running) {
      logger.warn('Job runner already running');
      return;
    }

    this.running = true;
    this.paused = false;
    logger.info('Job runner started', { concurrency: this.concurrency });
    this._poll();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Job runner stopped');
  }

  pause() {
    this.paused = true;
    logger.info('Job runner paused');
  }

  resume() {
    this.paused = false;
    logger.info('Job runner resumed');
  }

  async _poll() {
    if (!this.running) return;

    try {
      if (!this.paused && this.activeJobs.size < this.concurrency) {
        const availableSlots = this.concurrency - this.activeJobs.size;
        const jobs = this.jobRepo.findPendingJobs(availableSlots);

        for (const job of jobs) {
          if (this.activeJobs.size >= this.concurrency) break;
          this._processJob(job);
        }
      }
    } catch (err) {
      logger.error('Error polling for jobs', { error: err.message });
    }

    this.pollTimer = setTimeout(() => this._poll(), this.pollInterval);
  }

  async _processJob(job) {
    const handler = this.handlers[job.type];
    if (!handler) {
      logger.error('No handler registered for job type', { type: job.type });
      this.jobRepo.markFailed(job.id, `No handler for type: ${job.type}`);
      return;
    }

    this.activeJobs.set(job.id, job);
    this.jobRepo.markRunning(job.id);
    this.emit('job:started', job);

    logger.debug('Processing job', { id: job.id, type: job.type, attempt: job.attempts + 1 });

    try {
      const result = await handler(job.payload, job);
      this.jobRepo.markCompleted(job.id);
      this.emit('job:completed', job, result);
      logger.debug('Job completed', { id: job.id, type: job.type });
    } catch (err) {
      logger.error('Job failed', { id: job.id, type: job.type, error: err.message });

      const updatedJob = this.jobRepo.findById(job.id);
      if (updatedJob && updatedJob.attempts < updatedJob.maxAttempts) {
        const delay = this._calculateRetryDelay(updatedJob.attempts);
        this.jobRepo.markFailed(job.id, err.message);
        this.jobRepo.reschedule(job.id, delay);
        this.emit('job:retry', job, err, delay);
      } else {
        this.jobRepo.markFailed(job.id, err.message);
        this.emit('job:failed', job, err);
      }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  _calculateRetryDelay(attempts) {
    const base = config.sync.retryDelayMs;
    return base * Math.pow(2, attempts);
  }

  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  getStats() {
    return {
      running: this.running,
      paused: this.paused,
      activeJobs: this.activeJobs.size,
      concurrency: this.concurrency,
      ...this.jobRepo.getStats()
    };
  }

  async enqueue(type, payload, options = {}) {
    return this.jobRepo.create(type, payload, options);
  }

  setConcurrency(n) {
    this.concurrency = n;
    logger.info('Concurrency updated', { concurrency: n });
  }
}

module.exports = JobRunner;
