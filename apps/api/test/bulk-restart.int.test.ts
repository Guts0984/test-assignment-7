import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { Pool } from 'pg';
import { bootstrap } from '../src/db/bootstrap';
import { createTestDatabase, TEST_PASSWORDS } from './helpers/db';
import { call, cookieOf } from './helpers/http';
import { getJob, startJob, waitJob, terminal } from './helpers/jobs';
import type { Session } from './helpers/api';

/**
 * Real, separate API processes. The first is killed (SIGKILL = power cut, no cleanup at all, or
 * SIGTERM = graceful) in the middle of a 2000-product job; a second one must finish it
 * with every product changed exactly once.
 */
let databaseUrl: string;
let drop: () => Promise<void>;
let pool: Pool;
let counter = 0;
const procs: ChildProcess[] = [];

const spawnApi = async (extra: Record<string, string> = {}) => {
  const port = 4900 + Math.floor(Math.random() * 90) + counter++ * 100;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: 'test-secret-test-secret-test-secret-1',
      API_PORT: String(port),
      BULK_CHUNK_SIZE: '50',
      BULK_CHUNK_DELAY_MS: '120',
      BULK_POLL_MS: '50',
      BULK_WORKER_CONCURRENCY: '1',
      JOB_LEASE_SECONDS: '2',
      ...extra,
    },
    stdio: [
      'ignore',
      openSync(`/tmp/claude-1000/api-${counter}.log`, 'a'),
      openSync(`/tmp/claude-1000/api-${counter}.log`, 'a'),
    ],
  });
  procs.push(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) =>
    child.on('exit', (code, signal) => res({ code, signal })),
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${baseUrl}/ready`)).status === 200) return { child, baseUrl, exited };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('api did not start');
};

const login = async (baseUrl: string): Promise<Session> => {
  const r = await call(baseUrl, 'POST', '/auth/login', {
    body: { login: 'admin', password: TEST_PASSWORDS.admin },
  });
  return { cookie: cookieOf(r)!, login: 'admin' };
};

beforeAll(async () => {
  const db = await createTestDatabase();
  databaseUrl = db.url;
  drop = db.drop;
  await bootstrap(databaseUrl, TEST_PASSWORDS);
  pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', () => undefined);
}, 60_000);
afterAll(async () => {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGKILL');
  await pool?.end();
  await drop?.();
});

const stocks = async () =>
  new Map(
    (await pool.query('select id, stock from products')).rows.map((r) => [
      r.id as string,
      r.stock as number,
    ]),
  );

const exactlyOnce = async (jobId: string, before: Map<string, number>, delta: number) => {
  for (const [id, stock] of await stocks()) expect(stock, id).toBe(before.get(id)! + delta);
  const h = await pool.query(
    `select product_id, count(*)::int n from product_changes where job_id=$1 group by product_id`,
    [jobId],
  );
  expect(h.rowCount).toBe(2000);
  expect(h.rows.every((r) => r.n === 1)).toBe(true);
};

describe('API restarted in the middle of a job', () => {
  it('kill -9 mid-job: another process takes over after the lease, nothing is applied twice or lost', async () => {
    const before = await stocks();
    const a = await spawnApi();
    const ses = await login(a.baseUrl);
    const job = await startJob(a, ses, {
      filter: {},
      operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '5' },
    });
    const mid = await waitJob(a, ses, job.id, (j) => j.processed >= 300);
    expect(mid.processed).toBeLessThan(2000);

    a.child.kill('SIGKILL');
    expect((await a.exited).signal).toBe('SIGKILL');
    const frozen = (
      await pool.query('select processed, status, locked_by from bulk_jobs where id=$1', [job.id])
    ).rows[0];
    expect(frozen.status).toBe('running'); // nobody cleaned up: this is the crash case
    expect(frozen.processed).toBeLessThan(2000);

    const b = await spawnApi();
    const sesB = await login(b.baseUrl);
    const done = await waitJob(b, sesB, job.id, terminal, 60_000);
    expect(done).toMatchObject({ status: 'done', total: 2000, processed: 2000, applied: 2000 });
    await exactlyOnce(job.id, before, 5);

    b.child.kill('SIGKILL');
    await b.exited;
  }, 120_000);

  it('SIGTERM mid-job: exits 0 on a chunk boundary and hands the job back immediately (no waiting for the lease)', async () => {
    const before = await stocks();
    const a = await spawnApi({ JOB_LEASE_SECONDS: '600' }); // lease so long that only a graceful release can work
    const ses = await login(a.baseUrl);
    const job = await startJob(a, ses, {
      filter: {},
      operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '9' },
    });
    await waitJob(a, ses, job.id, (j) => j.processed >= 300);

    a.child.kill('SIGTERM');
    const { code, signal } = await a.exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });

    const row = (
      await pool.query(
        'select processed, applied, status, locked_by, lease_until from bulk_jobs where id=$1',
        [job.id],
      )
    ).rows[0];
    expect(row.status).toBe('running');
    expect(row.locked_by).toBeNull();
    expect(row.lease_until).toBeNull();
    expect(row.processed % 50).toBe(0); // stopped on a part boundary
    expect(row.processed).toBeLessThan(2000);
    const sum = (
      await pool.query(`select count(*)::int n from product_changes where job_id=$1`, [job.id])
    ).rows[0].n;
    expect(sum).toBe(row.applied); // what is counted is exactly what is in the history

    const b = await spawnApi({ JOB_LEASE_SECONDS: '600' });
    const sesB = await login(b.baseUrl);
    const resumed = await getJob(b, sesB, job.id);
    expect(resumed.processed).toBeGreaterThanOrEqual(row.processed); // continues from where it stopped, never restarts from 0
    const done = await waitJob(b, sesB, job.id, terminal, 60_000);
    expect(done).toMatchObject({ status: 'done', processed: 2000, applied: 2000 });
    await exactlyOnce(job.id, before, 9);
    b.child.kill('SIGTERM');
    expect((await b.exited).code).toBe(0);
  }, 120_000);

  it('two API processes running at once share jobs without ever double-applying (SKIP LOCKED)', async () => {
    const before = await stocks();
    const [a, b] = await Promise.all([
      spawnApi({ BULK_CHUNK_DELAY_MS: '20' }),
      spawnApi({ BULK_CHUNK_DELAY_MS: '20' }),
    ]);
    const ses = await login(a.baseUrl);
    const jobs = await Promise.all(
      [1, 2, 3, 4].map(() =>
        startJob(a, ses, {
          filter: {},
          operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '1' },
        }),
      ),
    );
    const done = await Promise.all(jobs.map((j) => waitJob(a, ses, j.id, terminal, 90_000)));
    expect(done.map((d) => d.status)).toEqual(Array(4).fill('done'));
    for (const [id, stock] of await stocks()) expect(stock).toBe(before.get(id)! + 4);
    for (const p of [a, b]) {
      p.child.kill('SIGTERM');
      expect((await p.exited).code).toBe(0);
    }
  }, 150_000);
});
