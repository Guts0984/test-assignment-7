import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['./vitest.setup.tsx'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 15_000,
  },
});
