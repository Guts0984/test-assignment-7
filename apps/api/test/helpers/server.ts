import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { createDb } from '../../src/db/client';
import { createLifecycle, type Lifecycle } from '../../src/common/lifecycle';
import { bootstrap } from '../../src/db/bootstrap';
import { createTestDatabase, TEST_PASSWORDS } from './db';

export type TestServer = {
  baseUrl: string;
  app: INestApplication;
  config: Config;
  lifecycle: Lifecycle;
  databaseUrl: string;
  pool: ReturnType<typeof createDb>['pool'];
  stop: () => Promise<void>;
};

/** Starts the *real* HTTP server (real sockets, real PostgreSQL, fresh seeded database). */
export const startServer = async (env: Record<string, string> = {}): Promise<TestServer> => {
  const database = await createTestDatabase();
  await bootstrap(database.url, TEST_PASSWORDS);
  const config = loadConfig({
    DATABASE_URL: database.url,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-1',
    API_PORT: '0',
    ...env,
  });
  const lifecycle = createLifecycle();
  const { db, pool } = createDb(config.DATABASE_URL, { onError: () => undefined });
  const app = await createApp({ config, db, pool, lifecycle });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    app,
    config,
    lifecycle,
    databaseUrl: database.url,
    pool,
    stop: async () => {
      await lifecycle.runShutdownHooks();
      await app.close();
      await pool.end().catch(() => undefined);
      await database.drop();
    },
  };
};
