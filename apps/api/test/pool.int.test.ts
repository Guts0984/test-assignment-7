import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { createTestDatabase } from './helpers/db';

let url: string;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ url, drop } = await createTestDatabase());
}, 30_000);
afterAll(async () => {
  await drop();
});

const killAll = async () => {
  const k = new Pool({ connectionString: url, max: 1 });
  k.on('error', () => undefined);
  await k.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`,
  );
  await k.end();
};

describe('connection pool survives PostgreSQL killing its connections (restart simulation)', () => {
  it('never leaks a client: far more failures than pool slots, then everything works again', async () => {
    const errors: string[] = [];
    const { db, pool } = createDb(url, { max: 3, onError: (e) => errors.push(e.message) });
    // warm the pool so it holds live connections that are about to die
    await Promise.all(Array.from({ length: 3 }, () => db.execute(sql`select 1`)));
    await killAll();

    // 30 transactions against dead connections: each may fail, none may leak its client.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 30 }, () => db.transaction(async (tx) => tx.execute(sql`select 1`))),
    );
    expect(outcomes.length).toBe(30);

    // The pool must be fully usable again, immediately.
    for (let i = 0; i < 10; i++) {
      await db.transaction(async (tx) => {
        const r = await tx.execute<{ n: number }>(sql`select ${i}::int as n`);
        expect(r.rows[0]!.n).toBe(i);
      });
    }
    expect(pool.waitingCount).toBe(0);
    expect(pool.totalCount - pool.idleCount).toBe(0); // nothing is stuck checked out

    const t0 = Date.now();
    await pool.end(); // would hang forever if a client had leaked
    expect(Date.now() - t0).toBeLessThan(2_000);
  }, 30_000);

  it('does not crash the process when a checked-out connection dies, and reports the error', async () => {
    const { db, pool } = createDb(url, { max: 2, onError: () => undefined });
    const slow = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(1)`);
    });
    await new Promise((r) => setTimeout(r, 150));
    await killAll();
    await expect(slow).rejects.toBeDefined(); // a failed query, not an uncaught exception
    await db.execute(sql`select 1`); // and the pool heals
    await pool.end();
  }, 30_000);

  it('DETERMINISTIC: a connection whose BEGIN fails (died with the server) is not leaked', async () => {
    const { db, pool } = createDb(url, { max: 3, onError: () => undefined });
    const realConnect = pool.connect.bind(pool) as () => Promise<import('pg').PoolClient>;
    let broken = true;
    // The pool hands out a connection that PostgreSQL has already dropped: its BEGIN fails.
    (pool as unknown as { connect: () => Promise<import('pg').PoolClient> }).connect = async () => {
      const c = await realConnect();
      const q = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
      (c as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = (...a) =>
        broken &&
        /^begin/i.test(typeof a[0] === 'string' ? a[0] : String((a[0] as { text?: string })?.text))
          ? Promise.reject(new Error('Connection terminated unexpectedly'))
          : q(...a);
      return c;
    };
    for (let i = 0; i < 12; i++) {
      await expect(db.transaction(async (tx) => tx.execute(sql`select 1`))).rejects.toBeDefined();
    }
    broken = false;
    // 12 failures on a pool of 3: a leaking implementation would now be out of clients and time out.
    await db.transaction(async (tx) => tx.execute(sql`select 1`));
    expect(pool.totalCount - pool.idleCount).toBe(0);
    await pool.end();
  }, 30_000);
});
