import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { loadConfig } from '../config';
import { hashPassword } from '../common/password';
import { createDb, type Db } from './client';
import { generateProducts, SEED_USERS } from './seed-data';
import { products, userCategories, users } from './schema';

const BOOTSTRAP_LOCK = 727_001;

export const seedIfEmpty = async (db: Db, passwords: Record<string, string>): Promise<boolean> => {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if ((existing[0]?.n ?? 0) > 0) return false;
  await db.transaction(async (tx) => {
    for (const u of SEED_USERS) {
      const pw = passwords[u.login];
      if (!pw) throw new Error(`No seed password for ${u.login}`);
      const [row] = await tx
        .insert(users)
        .values({ login: u.login, role: u.role, passwordHash: await hashPassword(pw) })
        .returning({ id: users.id });
      if (row && u.categories.length) {
        await tx
          .insert(userCategories)
          .values(u.categories.map((category) => ({ userId: row.id, category })));
      }
    }
    const all = generateProducts();
    for (let i = 0; i < all.length; i += 500) {
      await tx.insert(products).values(all.slice(i, i + 500));
    }
  });
  return true;
};

/** Runs migrations and seed exactly once, even if several containers start at the same time. */
export const bootstrap = async (
  databaseUrl: string,
  passwords: Record<string, string>,
): Promise<void> => {
  const { db, pool } = createDb(databaseUrl, { max: 2 });
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [BOOTSTRAP_LOCK]);
    await migrate(db, {
      migrationsFolder: process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle'),
    });
    const seeded = await seedIfEmpty(db, passwords);
    console.log(seeded ? 'bootstrap: migrated and seeded' : 'bootstrap: migrated (already seeded)');
  } finally {
    await client.query('select pg_advisory_unlock($1)', [BOOTSTRAP_LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
};

if (process.argv[1] && /bootstrap\.(ts|cjs|js)$/.test(process.argv[1])) {
  const cfg = loadConfig();
  const need = (v: string | undefined, name: string): string => {
    if (!v) throw new Error(`${name} must be set (see .env.example)`);
    return v;
  };
  bootstrap(cfg.DATABASE_URL, {
    admin: need(cfg.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD'),
    editor1: need(cfg.SEED_EDITOR1_PASSWORD, 'SEED_EDITOR1_PASSWORD'),
    editor2: need(cfg.SEED_EDITOR2_PASSWORD, 'SEED_EDITOR2_PASSWORD'),
    viewer: need(cfg.SEED_VIEWER_PASSWORD, 'SEED_VIEWER_PASSWORD'),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
