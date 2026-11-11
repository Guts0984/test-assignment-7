import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

const looksLikeConnectionError = (e: unknown): boolean => {
  let cur: unknown = e;
  for (let d = 0; d < 3 && typeof cur === 'object' && cur !== null; d++) {
    const o = cur as { code?: string; message?: string; cause?: unknown };
    if (o.code && (/^(08|57)/.test(o.code) || /^E(CONN|PIPE|TIMEDOUT)/.test(o.code))) return true;
    if (o.message && /Connection terminated|server closed the connection|ECONN/i.test(o.message))
      return true;
    cur = o.cause;
  }
  return false;
};

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

  /**
   * drizzle's pool transaction issues BEGIN *outside* its try/finally: if the pool hands out a
   * connection that died with PostgreSQL (restart), BEGIN throws and the client is never released.
   * After `max` such failures the pool is exhausted for good, even once the database is back.
   * We check the client out ourselves so it is always released, and destroyed when it is broken.
   */
  const transaction: typeof db.transaction = async (fn, config) => {
    const client = await pool.connect();
    let failure: unknown;
    try {
      return await drizzle(client, { schema }).transaction(fn, config);
    } catch (e) {
      failure = e;
      throw e;
    } finally {
      client.release(
        failure !== undefined && looksLikeConnectionError(failure)
          ? new Error('broken connection')
          : undefined,
      );
    }
  };
  db.transaction = transaction;
  return { db, pool };
};
