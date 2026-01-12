const App = require('./app');
const logger = require('./utils/logger');

const app = new App();

async function main() {
  try {
    await app.initialize();
    app.start();
  } catch (err) {
    logger.error('Failed to start application', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// graceful shutdown handlers
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await app.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

main();
