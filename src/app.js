const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');

const { getDatabase } = require('./persistence');
const { FileRepository, JobRepository, CheckpointRepository, TokenRepository } = require('./persistence');
const { GoogleAuthClient, DriveClient } = require('./api');
const { JobRunner, JOB_TYPES, createFullSyncHandler, createIncrementalSyncHandler } = require('./jobs');
const { SyncEngine } = require('./sync');
const { createAuthRouter, createSyncRouter, createJobsRouter, createFilesRouter } = require('./routes');

class App {
  constructor() {
    this.express = express();
    this.dbManager = null;
    this.jobRunner = null;
  }

  async initialize() {
    // init database (async for sql.js)
    this.dbManager = await getDatabase(config.db.path);

    // init repositories
    this.fileRepo = new FileRepository(this.dbManager);
    this.jobRepo = new JobRepository(this.dbManager);
    this.checkpointRepo = new CheckpointRepository(this.dbManager);
    this.tokenRepo = new TokenRepository(this.dbManager);

    // init auth client
    this.authClient = new GoogleAuthClient(this.tokenRepo);
    await this.authClient.loadCredentials();

    // init drive client
    this.driveClient = new DriveClient(this.authClient);

    // init job runner
    this.jobRunner = new JobRunner(this.jobRepo);

    // register job handlers
    this.jobRunner.registerHandler(
      JOB_TYPES.FULL_SYNC,
      createFullSyncHandler(this.driveClient, this.fileRepo, this.checkpointRepo, this.jobRepo)
    );

    this.jobRunner.registerHandler(
      JOB_TYPES.INCREMENTAL_SYNC,
      createIncrementalSyncHandler(this.driveClient, this.fileRepo, this.checkpointRepo)
    );

    // init sync engine
    this.syncEngine = new SyncEngine({
      driveClient: this.driveClient,
      fileRepository: this.fileRepo,
      checkpointRepository: this.checkpointRepo,
      jobRepository: this.jobRepo,
      jobRunner: this.jobRunner
    });

    // setup express middleware
    this.express.use(express.json());

    // request logging
    this.express.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`${req.method} ${req.path}`, {
          status: res.statusCode,
          duration: `${duration}ms`
        });
      });
      next();
    });

    // routes
    this.express.use('/auth', createAuthRouter(this.authClient));
    this.express.use('/sync', createSyncRouter(this.syncEngine, this.authClient));
    this.express.use('/jobs', createJobsRouter(this.jobRunner, this.jobRepo));
    this.express.use('/files', createFilesRouter(this.fileRepo));

    // health check
    this.express.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        authenticated: this.authClient.isAuthenticated(),
        jobRunner: this.jobRunner.getStats()
      });
    });

    // error handler
    this.express.use((err, req, res, next) => {
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
      res.status(500).json({ error: 'Internal server error' });
    });

    logger.info('Application initialized');
  }

  start() {
    // start job runner
    this.jobRunner.start();

    // start http server
    this.server = this.express.listen(config.server.port, () => {
      logger.info(`Server listening on port ${config.server.port}`);
    });
  }

  async stop() {
    logger.info('Shutting down...');

    this.jobRunner.stop();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }

    if (this.dbManager) {
      this.dbManager.close();
    }

    logger.info('Shutdown complete');
  }
}

module.exports = App;
