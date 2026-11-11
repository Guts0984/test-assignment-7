import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration files each boot a server, scrypt and PostgreSQL; unbounded parallelism makes timing tests flaky.
    maxWorkers: 3,
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one PostgreSQL server but each file creates its own database.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
