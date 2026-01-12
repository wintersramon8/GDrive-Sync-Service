const createAuthRouter = require('./auth');
const createSyncRouter = require('./sync');
const createJobsRouter = require('./jobs');
const createFilesRouter = require('./files');

module.exports = {
  createAuthRouter,
  createSyncRouter,
  createJobsRouter,
  createFilesRouter
};
