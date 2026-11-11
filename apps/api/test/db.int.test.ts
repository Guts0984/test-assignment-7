import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { bootstrap } from '../src/db/bootstrap';
import { validateProductState, CATEGORIES } from '@catalog/shared';
import { verifyPassword } from '../src/common/password';
import { createTestDatabase, TEST_PASSWORDS } from './helpers/db';

let url: string;
let drop: () => Promise<void>;
let pool: Pool;

beforeAll(async () => {
  ({ url, drop } = await createTestDatabase());
  // Four containers starting simultaneously must still produce exactly one seed.
  await Promise.all([1, 2, 3, 4].map(() => bootstrap(url, TEST_PASSWORDS)));
  pool = new Pool({ connectionString: url });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await drop();
});

const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

describe('bootstrap + seed', () => {
  it('concurrent bootstrap seeds exactly once', async () => {
    expect((await q('select count(*)::int n from users'))[0].n).toBe(4);
    expect((await q('select count(*)::int n from products'))[0].n).toBe(2000);
  });
  it('2000 products across all 20 categories', async () => {
    expect((await q('select count(distinct category)::int n from products'))[0].n).toBe(20);
  });
  it('editors have different, non-empty category sets; admin/viewer have none', async () => {
    const rows = await q(
      `select u.login, array_agg(c.category order by c.category) cats from users u
       left join user_categories c on c.user_id = u.id group by u.login`,
    );
    const by = Object.fromEntries(
      rows.map((r) => [r.login, (r.cats as (string | null)[]).filter(Boolean)]),
    );
    expect(by.editor1.length).toBeGreaterThan(0);
    expect(by.editor2.length).toBeGreaterThan(0);
    expect(by.editor1.filter((c: string) => by.editor2.includes(c))).toEqual([]);
    expect(by.admin).toEqual([]);
    expect(by.viewer).toEqual([]);
    for (const c of [...by.editor1, ...by.editor2]) expect(CATEGORIES).toContain(c);
  });
  it('seed data satisfies the shared cross-field rules', async () => {
    const rows = await q('select price, old_price as "oldPrice", status, category from products');
    const bad = rows.filter((r) => validateProductState(r).length > 0);
    expect(bad).toEqual([]);
  });
  it('passwords are hashed (scrypt) and verify; wrong password does not', async () => {
    const [u] = await q(`select password_hash h from users where login='admin'`);
    expect(u.h).not.toContain(TEST_PASSWORDS.admin);
    expect(await verifyPassword(TEST_PASSWORDS.admin, u.h)).toBe(true);
    expect(await verifyPassword('wrong', u.h)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORDS.admin, 'garbage')).toBe(false);
  });
  it('keeps decimals exact (numeric, not float)', async () => {
    const [r] = await q(
      `insert into products (sku, name, price, versions) values ('EXACT-1','x','0.10', '{}') returning price`,
    );
    expect(r.price).toBe('0.10');
    const [s] = await q(`select (price + 0.20)::text s from products where sku='EXACT-1'`);
    expect(s.s).toBe('0.30');
  });
});

describe('database constraints are a last line of defence', () => {
  const insert = (cols: string, vals: string) =>
    pool.query(
      `insert into products (sku, name, versions, ${cols}) values ('C-' || gen_random_uuid(), 'n', '{}', ${vals})`,
    );

  it.each([
    ['price', "'0'"],
    ['price', "'-1'"],
    ['stock', '-1'],
    ['status', "'bogus'"],
    ['status, price', "'active', null"],
    ['status, category, price', "'active', null, '5'"],
    ['price, old_price', "'10', '10'"],
    ['price, old_price', "'10', '9'"],
    ['old_price', "'10'"],
  ])('rejects (%s) = (%s)', async (cols, vals) => {
    await expect(insert(cols, vals)).rejects.toThrow();
  });
  it('rejects empty and 201-char names', async () => {
    await expect(
      pool.query(`insert into products (sku,name,versions) values ('N1','','{}')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`insert into products (sku,name,versions) values ('N2', repeat('x',201), '{}')`),
    ).rejects.toThrow();
  });
  it('sku is unique', async () => {
    await pool.query(`insert into products (sku,name,versions) values ('DUP','a','{}')`);
    await expect(
      pool.query(`insert into products (sku,name,versions) values ('DUP','b','{}')`),
    ).rejects.toThrow(/unique/);
  });
  it('login is unique and role restricted', async () => {
    await expect(
      pool.query(`insert into users (login,password_hash,role) values ('admin','x','admin')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`insert into users (login,password_hash,role) values ('z','x','root')`),
    ).rejects.toThrow();
  });
  it('history rejects unknown source', async () => {
    const [p] = await q(`select id from products limit 1`);
    await expect(
      pool.query(
        `insert into product_changes (product_id, field, version, source) values ($1,'name',1,'hack')`,
        [p.id],
      ),
    ).rejects.toThrow();
  });
});
