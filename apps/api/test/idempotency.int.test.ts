import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { IdempotencyService } from '../src/products/idempotency.service';
import { startServer, type TestServer } from './helpers/server';

let s: TestServer;
let userId: string;
let close: () => Promise<void>;
let db: ReturnType<typeof createDb>['db'];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  s = await startServer();
  const c = createDb(s.databaseUrl, { max: 6 });
  db = c.db;
  close = () => c.pool.end();
  userId = (await c.pool.query(`select id from users where login = 'admin'`)).rows[0].id;
}, 90_000);
afterAll(async () => {
  await close?.();
  await s?.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a slow but alive request is not mistaken for a crashed one', () => {
  it('while the owner works, a retry waits for it and gets its response: the work runs ONCE', async () => {
    // "stale" after 250 ms of silence; the owner proves it is alive every 50 ms
    const svc = new IdempotencyService(db, { staleMs: 250, heartbeatMs: 50 });
    let runs = 0;
    const work = async () => {
      runs++;
      await sleep(900); // far longer than staleMs
      return { n: runs };
    };
    const a = svc.run(userId, 'slow-alive-1', 'h', work);
    await sleep(100);
    const b = svc.run(userId, 'slow-alive-1', 'h', work); // the client's retry
    const [ra, rb] = await Promise.all([a, b]);
    expect(runs).toBe(1);
    expect(ra.replayed).toBe(false);
    expect(rb).toEqual({ body: { n: 1 }, replayed: true });
  });

  it('a CRASHED owner (no heartbeat) is still taken over after the stale time', async () => {
    const svc = new IdempotencyService(db, { staleMs: 250, heartbeatMs: 50 });
    // simulate the crash: a row left in_progress, last seen long ago
    await db.execute(
      sql`insert into idempotency_keys (user_id, key, request_hash, state, created_at) values (${userId}, 'crashed-1', 'h', 'in_progress', now() - interval '10 seconds')`,
    );
    let runs = 0;
    const r = await svc.run(userId, 'crashed-1', 'h', async () => ({ n: ++runs }));
    expect(runs).toBe(1);
    expect(r.replayed).toBe(false);
  });
});
