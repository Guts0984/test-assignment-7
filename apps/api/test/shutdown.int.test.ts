import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { createTestDatabase, TEST_PASSWORDS } from './helpers/db';
import { bootstrap } from '../src/db/bootstrap';

let child: ChildProcess;
let drop: () => Promise<void>;
const PORT = 4300 + Math.floor(Math.random() * 500);
let exitResolve: (v: { code: number | null; signal: string | null }) => void = () => undefined;
const exited = new Promise<{ code: number | null; signal: string | null }>((res) => {
  exitResolve = res;
});

const waitReady = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/ready`)).status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready');
};

beforeAll(async () => {
  const db = await createTestDatabase();
  drop = db.drop;
  await bootstrap(db.url, TEST_PASSWORDS);
  child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: db.url,
      SESSION_SECRET: 'test-secret-test-secret-test-secret-1',
      API_PORT: String(PORT),
    },
    stdio: 'ignore',
  });
  child.on('exit', (code, signal) => exitResolve({ code, signal }));
  await waitReady();
}, 60_000);

afterAll(async () => {
  if (child.exitCode === null) child.kill('SIGKILL');
  await drop();
});

describe('SIGTERM', () => {
  it('exits with code 0 even with a stuck half-open client, and stops accepting', async () => {
    // A slow client holding a connection mid-request must not prevent a clean exit.
    const sock = net.connect(PORT, '127.0.0.1');
    sock.on('error', () => undefined);
    sock.write('POST /x HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{');
    await new Promise((r) => setTimeout(r, 200));

    const t0 = Date.now();
    child.kill('SIGTERM');
    const { code, signal } = await exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(Date.now() - t0).toBeLessThan(15_000);
    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
    sock.destroy();
  }, 30_000);
});
