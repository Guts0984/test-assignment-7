import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { bootstrap } from '../src/db/bootstrap';
import { TEST_PASSWORDS } from './helpers/db';
import { call } from './helpers/http';
import { killAllSpawned, loginProcess, spawnApi } from './helpers/process';
import { getJob, startJob, terminal, waitJob } from './helpers/jobs';

/**
 * Restarts a real PostgreSQL server underneath a running API process. Needs Docker
 * (skipped when it is not available).
 */
const docker = (...a: string[]) =>
  execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
const hasDocker = (() => {
  try {
    docker('version');
    return true;
  } catch {
    return false;
  }
})();

const name = `catalog-pg-restart-${randomBytes(4).toString('hex')}`;
const port = 41_000 + Math.floor(Math.random() * 8_000);
const url = `postgres://postgres:pg@127.0.0.1:${port}/catalog`;
let pool: Pool;

const waitPg = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      docker('exec', name, 'pg_isready', '-U', 'postgres', '-d', 'catalog');
      const p = new Pool({ connectionString: url, max: 1 });
      p.on('error', () => undefined);
      await p.query('select 1');
      await p.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('postgres did not come up');
};

beforeAll(async () => {
  if (!hasDocker) return;
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=pg',
    '-e',
    'POSTGRES_DB=catalog',
    '-p',
    `127.0.0.1:${port}:5432`,
    'postgres:16-alpine',
  );
  await waitPg();
  await bootstrap(url, TEST_PASSWORDS);
  pool = new Pool({ connectionString: url });
  pool.on('error', () => undefined);
}, 120_000);

afterAll(async () => {
  killAllSpawned();
  await pool?.end().catch(() => undefined);
  if (hasDocker) {
    try {
      docker('rm', '-f', name);
    } catch {
      /* already gone */
    }
  }
});

describe.skipIf(!hasDocker)('PostgreSQL restarted under a live API', () => {
  it('the process survives, answers 503 (not 500/hang) during the outage and recovers by itself; a running job finishes exactly once', async () => {
    const api = await spawnApi(url, {
      BULK_CHUNK_SIZE: '50',
      BULK_CHUNK_DELAY_MS: '150',
      JOB_LEASE_SECONDS: '3',
    });
    const ses = await loginProcess(api.baseUrl);
    const before = new Map(
      (await pool.query('select id, stock from products')).rows.map((r) => [
        r.id as string,
        r.stock as number,
      ]),
    );
    const job = await startJob(api, ses, {
      filter: {},
      operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '3' },
    });
    await waitJob(api, ses, job.id, (j) => j.processed >= 200);

    // Probe the API continuously while the database is restarted (hard: no graceful stop).
    const seen: { path: string; status: number; ms: number; json: boolean }[] = [];
    let probing = true;
    const probe = (async () => {
      while (probing) {
        for (const path of ['/health', '/ready', '/me', '/products']) {
          const t0 = Date.now();
          try {
            const r = await call(api.baseUrl, 'GET', path, { cookie: ses.cookie });
            seen.push({
              path,
              status: r.status,
              ms: Date.now() - t0,
              json: typeof r.body === 'object',
            });
          } catch {
            seen.push({ path, status: 0, ms: Date.now() - t0, json: false }); // connection refused = process dead
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    docker('restart', '-t', '0', name);
    await waitPg();
    // recovery without touching the API
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      ready = (await fetch(`${api.baseUrl}/ready`)).status === 200;
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    probing = false;
    await probe;

    expect(api.child.exitCode).toBeNull(); // never crashed
    expect(ready).toBe(true);
    expect(seen.some((s) => s.status === 0)).toBe(false); // always reachable
    expect(seen.filter((s) => s.path === '/health').every((s) => s.status === 200)).toBe(true); // liveness never lies
    const outage = seen.filter((s) => s.path === '/ready' && s.status === 503);
    expect(outage.length).toBeGreaterThan(0); // readiness noticed the outage
    // while the database was away, DB-backed routes answered 503 with a JSON error, never a 500 or a hang
    const dbRoutes = seen.filter((s) => s.path === '/me' || s.path === '/products');
    expect(dbRoutes.some((s) => s.status === 503 && s.json)).toBe(true);
    expect(dbRoutes.every((s) => s.status !== 500)).toBe(true);
    expect(Math.max(...seen.map((s) => s.ms))).toBeLessThan(15_000);

    // sessions live in PostgreSQL and survived the restart
    expect((await call(api.baseUrl, 'GET', '/me', { cookie: ses.cookie })).status).toBe(200);
    // the connection pool healed: normal writes work
    const login2 = await loginProcess(api.baseUrl, 'editor1');
    expect(login2.cookie).toBeTruthy();

    // the job picked up again and everything was applied exactly once
    const done = await waitJob(api, ses, job.id, terminal, 90_000);
    expect(done).toMatchObject({ status: 'done', processed: 2000, applied: 2000 });
    for (const r of (await pool.query('select id, stock from products')).rows)
      expect(r.stock).toBe(before.get(r.id)! + 3);
    const once = await pool.query(
      `select count(*)::int n from (select product_id from product_changes where job_id=$1 group by product_id having count(*) > 1) x`,
      [job.id],
    );
    expect(once.rows[0].n).toBe(0);
    expect((await getJob(api, ses, job.id)).id).toBe(job.id);

    api.child.kill('SIGTERM');
    expect((await api.exited).code).toBe(0);
  }, 240_000);

  it('survives repeated restarts (3x) with no leak: the pool is as healthy at the end as at the start', async () => {
    const api = await spawnApi(url);
    const ses = await loginProcess(api.baseUrl);
    for (let i = 0; i < 3; i++) {
      docker('restart', '-t', '0', name);
      await waitPg();
      for (let k = 0; k < 100; k++) {
        if ((await fetch(`${api.baseUrl}/ready`)).status === 200) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(api.child.exitCode).toBeNull();
    }
    // 30 sequential + 30 parallel DB requests: a leaked pool (max 10) could not serve them
    for (let i = 0; i < 30; i++)
      expect((await call(api.baseUrl, 'GET', '/me', { cookie: ses.cookie })).status).toBe(200);
    const par = await Promise.all(
      Array.from({ length: 30 }, () => call(api.baseUrl, 'GET', '/me', { cookie: ses.cookie })),
    );
    expect(par.every((r) => r.status === 200)).toBe(true);
    api.child.kill('SIGTERM');
    expect((await api.exited).code).toBe(0);
  }, 240_000);
});
