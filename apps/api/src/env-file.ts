import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Local development: read the repository's root `.env` so `pnpm dev` needs no extra setup.
 * Variables that are already set (Docker, CI, the shell) always win; a missing file is fine.
 */
export const loadRootEnvFile = (): void => {
  for (const dir of [process.cwd(), resolve(process.cwd(), '../..')]) {
    const file = resolve(dir, '.env');
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
};
