const express = require('express');
const logger = require('../utils/logger');

function createSyncRouter(syncEngine, authClient) {
  const router = express.Router();

  // middleware to check auth
  const requireAuth = (req, res, next) => {
    if (!authClient.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    }
    next();
  };

  // Reset endpoint - no auth required for demo purposes
  router.post('/reset', (req, res) => {
    try {
      const result = syncEngine.resetAll();
      logger.info('Full reset completed via API', result);
      res.json({
        message: 'Database reset complete',
        deleted: result
      });
    } catch (err) {
      logger.error('Failed to reset', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.use(requireAuth);

  router.post('/full', async (req, res) => {
    try {
      const result = await syncEngine.startFullSync();
      res.json({
        message: 'Full sync started',
        ...result
      });
    } catch (err) {
      logger.error('Failed to start full sync', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/incremental', async (req, res) => {
    try {
      const result = await syncEngine.startIncrementalSync();
      res.json({
        message: 'Incremental sync started',
        ...result
      });
    } catch (err) {
      logger.error('Failed to start incremental sync', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:syncId/resume', async (req, res) => {
    try {
      const result = await syncEngine.resumeSync(req.params.syncId);
      res.json({
        message: 'Sync resumed',
        ...result
      });
    } catch (err) {
      logger.error('Failed to resume sync', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/:syncId/pause', (req, res) => {
    try {
      syncEngine.pauseSync(req.params.syncId);
      res.json({ message: 'Sync paused' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/current', (req, res) => {
    const status = syncEngine.getCurrentSync();
    if (!status) {
      return res.json({ message: 'No active sync' });
    }
    res.json(status);
  });

  router.get('/:syncId/status', (req, res) => {
    const status = syncEngine.getStatus(req.params.syncId);
    if (!status) {
      return res.status(404).json({ error: 'Sync not found' });
    }
    res.json(status);
  });

  router.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const history = syncEngine.getSyncHistory(limit);
    res.json(history);
  });

  router.delete('/files', (req, res) => {
    try {
      const count = syncEngine.deleteAllFiles();
      logger.info('All files deleted via API', { count });
      res.json({ message: 'All files deleted', count });
    } catch (err) {
      logger.error('Failed to delete files', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:syncId', (req, res) => {
    try {
      syncEngine.deleteSync(req.params.syncId);
      res.json({ message: 'Sync deleted successfully' });
    } catch (err) {
      logger.error('Failed to delete sync', { error: err.message, syncId: req.params.syncId });
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createSyncRouter;
