import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Every test file gets its own freshly created database on the real PostgreSQL pointed to by
 * TEST_DATABASE_URL (any database on the server; only used to run CREATE DATABASE).
 */
export const adminUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a PostgreSQL 16 server');
  return url;
};

export const createTestDatabase = async (): Promise<{ url: string; drop: () => Promise<void> }> => {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  await admin.query(`create database ${name}`);
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
};

export const TEST_PASSWORDS = {
  admin: 'admin-pass-123',
  editor1: 'editor1-pass-123',
  editor2: 'editor2-pass-123',
  viewer: 'viewer-pass-123',
} as const;
