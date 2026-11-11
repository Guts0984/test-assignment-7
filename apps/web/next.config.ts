import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local development: the repository's root .env (Next only reads apps/web/.env*). Real env vars win.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace dependencies from the repo root so the standalone bundle includes workspace packages.
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  transpilePackages: ['@catalog/shared'],
  poweredByHeader: false,
  async rewrites() {
    // The browser talks to one origin; the API sits behind it. Cookies stay first-party (SameSite=Lax works).
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};

export default withNextIntl(config);
