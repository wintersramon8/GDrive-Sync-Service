const express = require('express');
const logger = require('../utils/logger');

function createJobsRouter(jobRunner, jobRepository) {
  const router = express.Router();

  router.get('/stats', (req, res) => {
    const stats = jobRunner.getStats();
    res.json(stats);
  });

  router.get('/active', (req, res) => {
    const jobs = jobRunner.getActiveJobs();
    res.json(jobs);
  });

  router.get('/pending', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const jobs = jobRepository.findByStatus('pending', limit);
    res.json(jobs);
  });

  router.get('/failed', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const jobs = jobRepository.findByStatus('failed', limit);
    res.json(jobs);
  });

  router.get('/completed', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const jobs = jobRepository.findByStatus('completed', limit);
    res.json(jobs);
  });

  router.get('/dead-letter', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const jobs = jobRepository.getDeadLetterJobs(limit);
    res.json(jobs);
  });

  router.post('/dead-letter/:id/retry', (req, res) => {
    const deadId = parseInt(req.params.id, 10);
    try {
      const jobId = jobRepository.retryDeadJob(deadId);
      if (!jobId) {
        return res.status(404).json({ error: 'Dead letter job not found' });
      }
      res.json({ message: 'Job requeued', jobId });
    } catch (err) {
      logger.error('Failed to retry dead job', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id', (req, res) => {
    const job = jobRepository.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  router.post('/:id/retry', (req, res) => {
    const job = jobRepository.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'running') {
      return res.status(400).json({ error: 'Cannot retry a running job' });
    }

    jobRepository.reschedule(req.params.id, 0);
    res.json({ message: 'Job rescheduled' });
  });

  router.post('/runner/pause', (req, res) => {
    jobRunner.pause();
    res.json({ message: 'Job runner paused' });
  });

  router.post('/runner/resume', (req, res) => {
    jobRunner.resume();
    res.json({ message: 'Job runner resumed' });
  });

  router.post('/runner/concurrency', (req, res) => {
    const { concurrency } = req.body;
    if (typeof concurrency !== 'number' || concurrency < 1) {
      return res.status(400).json({ error: 'Invalid concurrency value' });
    }
    jobRunner.setConcurrency(concurrency);
    res.json({ message: 'Concurrency updated', concurrency });
  });

  return router;
}

module.exports = createJobsRouter;
