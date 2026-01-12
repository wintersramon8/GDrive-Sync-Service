const express = require('express');

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

  return router;
}

module.exports = createFilesRouter;
