import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local development: the repository's root .env (Next only reads apps/web/.env*). Real env vars win.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

const config: NextConfig = {
  // Login-page demo hint: same variables that seed the users (see entities/session/model/demo-accounts.ts).
  env: {
    NEXT_PUBLIC_SHOW_DEMO_LOGINS: process.env.SHOW_DEMO_LOGINS ?? 'true',
    NEXT_PUBLIC_DEMO_PW_ADMIN: process.env.SEED_ADMIN_PASSWORD ?? '',
    NEXT_PUBLIC_DEMO_PW_EDITOR1: process.env.SEED_EDITOR1_PASSWORD ?? '',
    NEXT_PUBLIC_DEMO_PW_EDITOR2: process.env.SEED_EDITOR2_PASSWORD ?? '',
    NEXT_PUBLIC_DEMO_PW_VIEWER: process.env.SEED_VIEWER_PASSWORD ?? '',
  },
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
