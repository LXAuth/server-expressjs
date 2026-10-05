import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info('Server listening', {
    port: config.server.port,
    host: config.server.host,
    env: config.env,
    database: config.prod ? 'postgresql' : 'sqlite',
  });
});

/**
 * Signals that in-flight work should not be started but may finish.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${config.server.port} is already in use.`, { error });
    process.exit(1);
  }
  logger.error('Server failed to start', { error });
  process.exit(1);
});

let shuttingDown = false;

/**
 * Graceful shutdown.
 *
 * Stop accepting connections first, then let in-flight requests finish, then
 * close the database pool. Reversing the last two would cut a request off
 * mid-query, so the order is the whole implementation.
 *
 * A second signal exits immediately — an operator who sends SIGINT twice means
 * it, and holding the process open to finish politely would be ignoring them.
 */
function shutdown(signal: string): void {
  if (shuttingDown) {
    logger.warn(`Received ${signal} during shutdown, exiting now.`);
    process.exit(1);
  }
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully.`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit.', {
      timeoutMs: config.server.shutdownTimeoutMs,
    });
    process.exit(1);
  }, config.server.shutdownTimeoutMs);
  forceExit.unref();

  server.close(async (error) => {
    clearTimeout(forceExit);

    if (error) {
      logger.error('Error while closing the HTTP server', { error });
      process.exit(1);
    }

    try {
      await disconnectPrisma();
      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (disconnectError) {
      logger.error('Error while closing the database pool', { error: disconnectError });
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  // The process is in an unknown state after this. Log, then leave through the
  // same door rather than continuing to serve requests from it.
  logger.error('Uncaught exception', { error });
  shutdown('uncaughtException');
});
