import { defineConfig, devices } from '@playwright/test';

/**
 * e2e runs against the real stack (docker compose: nginx -> web + api -> PostgreSQL).
 *   docker compose up --build -d --wait && pnpm --filter @catalog/web e2e
 * One browser per CI job (`--project=chromium|firefox|webkit`); the `setup` project logs the four seed
 * users in once and stores their sessions, so tests do not hammer the login rate limit.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
