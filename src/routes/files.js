const express = require('express');
const logger = require('../utils/logger');

function createFilesRouter(fileRepository) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const files = fileRepository.getAll(limit, offset);
    const total = fileRepository.count();

    res.json({
      files,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + files.length < total
      }
    });
  });

  router.get('/count', (req, res) => {
    const count = fileRepository.count();
    res.json({ count });
  });

  router.get('/:id', (req, res) => {
    const file = fileRepository.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  });

  router.get('/:id/children', (req, res) => {
    const children = fileRepository.findByParentId(req.params.id);
    res.json(children);
  });

  router.delete('/', (req, res) => {
    try {
      const count = fileRepository.deleteAll();
      logger.info('All files deleted via API', { count });
      res.json({ message: 'All files deleted', count });
    } catch (err) {
      logger.error('Failed to delete all files', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const file = fileRepository.findById(req.params.id);
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
      const deleted = fileRepository.deleteById(req.params.id);
      logger.info('File deleted', { id: req.params.id, deleted });
      res.json({ message: 'File deleted', id: req.params.id });
    } catch (err) {
      logger.error('Failed to delete file', { error: err.message, id: req.params.id });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createFilesRouter;
