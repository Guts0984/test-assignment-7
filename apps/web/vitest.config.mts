import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: {
    env: {
      NEXT_PUBLIC_SHOW_DEMO_LOGINS: 'true',
      NEXT_PUBLIC_DEMO_PW_ADMIN: 'admin-pass-123',
      NEXT_PUBLIC_DEMO_PW_EDITOR1: 'editor1-pass-123',
      NEXT_PUBLIC_DEMO_PW_EDITOR2: 'editor2-pass-123',
      NEXT_PUBLIC_DEMO_PW_VIEWER: 'viewer-pass-123',
    },
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['./vitest.setup.tsx'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 15_000,
  },
});
