import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();

/**
 * `pnpm test` works with no setup: unless TEST_DATABASE_URL is provided (CI uses a service container),
 * a throwaway PostgreSQL 16 container is started for the run and removed afterwards.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) return async () => undefined;

  const name = `catalog-test-pg-${randomBytes(4).toString('hex')}`;
  try {
    docker('version');
  } catch {
    throw new Error(
      'The API tests need PostgreSQL. Either start Docker, or set TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres',
    );
  }
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=pg',
    '-p',
    '127.0.0.1::5432',
    'postgres:16-alpine',
  );
  const hostPort = docker('port', name, '5432/tcp').split(':').pop();
  const url = `postgres://postgres:pg@127.0.0.1:${hostPort}/postgres`;

  for (let i = 0; i < 100; i++) {
    const p = new Pool({ connectionString: url, max: 1 });
    p.on('error', () => undefined);
    try {
      await p.query('select 1');
      await p.end();
      break;
    } catch {
      await p.end().catch(() => undefined);
      if (i === 99) {
        docker('rm', '-f', name);
        throw new Error('test PostgreSQL did not become ready');
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  process.env.TEST_DATABASE_URL = url;
  return async () => {
    docker('rm', '-f', name);
  };
}
