import { config } from './config/env.js';
import { closePool } from './db/client.js';
import { createDispatcher } from './queue/index.js';
import { getRedis, type JobDispatcher } from './queue/dispatcher.js';
import { buildServer } from './server.js';

/**
 * Process entrypoint.
 *
 * Owns exactly three things the request path does not: building the dispatcher,
 * binding the port, and shutting down cleanly when the platform asks it to.
 */

async function main(): Promise<void> {
  const dispatcher = createDispatcher();
  const app = await buildServer({ dispatcher });

  let shuttingDown = false;

  /**
   * Stops accepting connections, then releases the pool.
   *
   * `app.close()` waits for in-flight requests, so a deploy does not cut a
   * response in half. The failure paths here log rather than throw: a shutdown
   * that cannot complete cleanly should still exit, and the process supervisor
   * escalates if it does not.
   */
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');

    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, 'Error while closing the HTTP server');
    }

    try {
      await dispatcher.close();
      if (dispatcher.kind === 'redis') await getRedis().quit();
    } catch (error) {
      app.log.error({ err: error }, 'Error while closing the job dispatcher');
    }

    try {
      await closePool();
    } catch (error) {
      app.log.error({ err: error }, 'Error while closing the database pool');
    }

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // An unhandled rejection leaves the process in an unknown state; log it and
  // let the supervisor replace this instance rather than limping on.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Unhandled promise rejection');
  });

  try {
    await app.listen({ port: config.api.port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start the server');
    process.exit(1);
  }

  if (dispatcher.kind === 'inline') {
    app.log.warn(
      'QUEUE_DRIVER=inline — jobs are processed inside this process by the mock engine. ' +
        'Set QUEUE_DRIVER=redis and run the worker for the real path.',
    );
  }
}

/** Re-exported so tests can build a dispatcher without starting a listener. */
export { createDispatcher };
export type { JobDispatcher };

void main();
