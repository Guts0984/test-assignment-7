import { spawn, type ChildProcess } from 'node:child_process';
import { call, cookieOf } from './http';
import { TEST_PASSWORDS } from './db';
import type { Session } from './api';

export type ApiProcess = {
  child: ChildProcess;
  baseUrl: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

let counter = 0;
const spawned: ChildProcess[] = [];

/** Starts the real server entrypoint (src/main.ts) as its own OS process and waits until /ready. */
export const spawnApi = async (
  databaseUrl: string,
  extra: Record<string, string> = {},
): Promise<ApiProcess> => {
  const port = 5100 + Math.floor(Math.random() * 90) + counter++ * 100;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      API_PORT: String(port),
      BULK_POLL_MS: '50',
      BULK_WORKER_CONCURRENCY: '1',
      ...extra,
    },
    stdio: 'ignore',
  });
  spawned.push(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) =>
    child.on('exit', (code, signal) => res({ code, signal })),
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${baseUrl}/ready`)).status === 200) return { child, baseUrl, exited };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('api did not become ready');
};

export const killAllSpawned = () => {
  for (const p of spawned) if (p.exitCode === null) p.kill('SIGKILL');
};

export const loginProcess = async (
  baseUrl: string,
  who = 'admin' as keyof typeof TEST_PASSWORDS,
): Promise<Session> => {
  const r = await call(baseUrl, 'POST', '/auth/login', {
    body: { login: who, password: TEST_PASSWORDS[who] },
  });
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  return { cookie: cookieOf(r)!, login: who };
};
