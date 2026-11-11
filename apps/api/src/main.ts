import 'reflect-metadata';
import type { Server } from 'node:http';
import { createApp, logger } from './app';
import { loadConfig } from './config';
import { loadRootEnvFile } from './env-file';
import { createDb } from './db/client';
import { createLifecycle } from './common/lifecycle';
import { startWorker } from './bulk/worker';

const main = async () => {
  loadRootEnvFile();
  const config = loadConfig();
  const lifecycle = createLifecycle();
  const { db, pool } = createDb(config.DATABASE_URL, {
    onError: (e) => logger.warn(`pg pool error (will reconnect): ${e.message}`),
  });
  if (process.env.NODE_ENV === 'production' && !config.COOKIE_SECURE) {
    logger.warn(
      'COOKIE_SECURE=false: the session cookie is sent over plain HTTP. Fine for localhost; behind a real domain terminate TLS at the edge and set COOKIE_SECURE=true (README, "TLS").',
    );
  }
  const app = await createApp({ config, db, pool, lifecycle });
  if (config.BULK_WORKER_ENABLED) {
    const worker = startWorker(db, config, { warn: (m) => logger.warn(m) });
    // Stops on a chunk boundary and hands the lease back, so a restarted api resumes at once.
    lifecycle.onShutdown(worker.stop);
  }
  await app.listen(config.API_PORT, '0.0.0.0');
  logger.log(`listening on :${config.API_PORT}`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal}: shutting down`);
    const force = setTimeout(() => {
      logger.error('forced exit after timeout');
      process.exit(1);
    }, config.SHUTDOWN_GRACE_MS + 8_000);
    force.unref();
    try {
      lifecycle.shuttingDown = true; // /ready -> 503 immediately
      const server = app.getHttpServer() as Server;
      // Stop accepting; in-flight requests finish. Idle keep-alive sockets are dropped right away,
      // sockets still stuck mid-request (slow clients) after the grace period are cut.
      const sweep = setInterval(() => server.closeIdleConnections?.(), 100);
      const grace = setTimeout(() => server.closeAllConnections?.(), config.SHUTDOWN_GRACE_MS);
      await app.close();
      clearInterval(sweep);
      clearTimeout(grace);
      await lifecycle.runShutdownHooks(); // workers stop on a chunk boundary
      await pool.end();
      process.exit(0);
    } catch (e) {
      logger.error(`shutdown failed: ${String(e)}`);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // A stray rejection must not take the whole process (and every user's session) down.
  process.on('unhandledRejection', (e) => logger.error(`unhandledRejection: ${String(e)}`));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
