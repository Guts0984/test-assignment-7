import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { Pool } from 'pg';
import { createTestDatabase, TEST_PASSWORDS } from './helpers/db';
import { bootstrap } from '../src/db/bootstrap';
import { killAllSpawned, loginProcess, spawnApi } from './helpers/process';
import { call } from './helpers/http';

let databaseUrl: string;
let drop: () => Promise<void>;
let pool: Pool;

beforeAll(async () => {
  const db = await createTestDatabase();
  databaseUrl = db.url;
  drop = db.drop;
  await bootstrap(databaseUrl, TEST_PASSWORDS);
  pool = new Pool({ connectionString: databaseUrl });
}, 60_000);
afterAll(async () => {
  killAllSpawned();
  await pool?.end();
  await drop?.();
});

describe('SIGTERM', () => {
  it('exits 0 even with a stuck half-open client, and stops accepting', async () => {
    // short grace: the stuck client must not hold the exit for the production default
    const api = await spawnApi(databaseUrl, { SHUTDOWN_GRACE_MS: '3000' });
    const port = Number(new URL(api.baseUrl).port);
    // A slow client holding a connection mid-request must not prevent a clean exit.
    const sock = net.connect(port, '127.0.0.1');
    sock.on('error', () => undefined);
    sock.write('POST /x HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{');
    await new Promise((r) => setTimeout(r, 200));

    const t0 = Date.now();
    api.child.kill('SIGTERM');
    const { code, signal } = await api.exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(Date.now() - t0).toBeLessThan(15_000);
    await expect(fetch(`${api.baseUrl}/health`)).rejects.toThrow();
    sock.destroy();
  }, 40_000);

  it('requests already in flight run to completion and are fully applied; then exit 0', async () => {
    const api = await spawnApi(databaseUrl);
    const ses = await loginProcess(api.baseUrl);
    const ids = (await pool.query('select id from products order by id limit 2000')).rows.map(
      (r) => r.id as string,
    );
    const batch = (slice: string[], base: number) =>
      call(api.baseUrl, 'PATCH', '/products/batch', {
        cookie: ses.cookie,
        body: {
          changes: slice.map((id, i) => ({ id, field: 'stock', value: base + i, baseVersion: 0 })),
        },
      });

    const finishedAt: number[] = [];
    const inflight = [batch(ids.slice(0, 1000), 20_000), batch(ids.slice(1000, 2000), 30_000)].map(
      (p) =>
        p.then((r) => {
          finishedAt.push(Date.now());
          return r;
        }),
    );
    await new Promise((r) => setTimeout(r, 60)); // requests are accepted and being processed
    const signalledAt = Date.now();
    api.child.kill('SIGTERM');

    const rs = await Promise.all(inflight);
    for (const r of rs) {
      expect(r.status).toBe(200);
      expect(
        (r.body as { results: { status: string }[] }).results.every((x) => x.status === 'ok'),
      ).toBe(true);
    }
    expect(finishedAt.some((t) => t > signalledAt)).toBe(true); // genuinely in flight when the signal arrived
    expect((await api.exited).code).toBe(0);

    const stocks = (await pool.query('select id, stock from products')).rows;
    const byId = new Map(stocks.map((r) => [r.id as string, r.stock as number]));
    ids.forEach((id, i) => expect(byId.get(id)).toBe((i < 1000 ? 20_000 : 30_000) + (i % 1000)));
  }, 60_000);

  it('a second SIGTERM / SIGINT while shutting down does not break the exit', async () => {
    const api = await spawnApi(databaseUrl);
    api.child.kill('SIGTERM');
    api.child.kill('SIGINT');
    expect((await api.exited).code).toBe(0);
  }, 30_000);
});
