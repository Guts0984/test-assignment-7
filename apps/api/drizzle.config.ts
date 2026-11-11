import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Only used by `drizzle-kit generate` (no DB connection needed), kept for `studio`/`push` convenience.
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/catalog' },
});
