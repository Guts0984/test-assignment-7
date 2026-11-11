import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Pool errors (e.g. PostgreSQL restarting) are emitted on idle clients; without a
 * listener Node treats them as uncaught and the process dies. We log and carry on —
 * the pool replaces broken clients on its own.
 */
export const createDb = (
  databaseUrl: string,
  opts: { max?: number; onError?: (e: Error) => void } = {},
) => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });
  pool.on('error', (e) => opts.onError?.(e));
  // A client that is checked out when PostgreSQL goes away emits 'error' on itself; with no
  // listener that would be an uncaught exception and kill the process.
  pool.on('connect', (client) => client.on('error', (e) => opts.onError?.(e)));
  const db = drizzle(pool, { schema });
  return { db, pool };
};
