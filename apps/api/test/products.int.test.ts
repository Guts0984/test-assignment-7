import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { apiErrorSchema, historyResponseSchema, type ProductRow } from '@catalog/shared';
import { startServer, type TestServer } from './helpers/server';
import { call } from './helpers/http';
import {
  history,
  listProducts,
  loginAs,
  one,
  patchBatch,
  pick,
  results,
  type Session,
} from './helpers/api';

let s: TestServer;
let pool: Pool;
let admin: Session;
let admin2: Session;
let editor1: Session;
let editor2: Session;
let viewer: Session;
let all: ProductRow[];
let e1Cats: string[];
let e2Cats: string[];

const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
const db = async (id: string) => (await q('select * from products where id = $1', [id]))[0];
const changes = async (id: string) =>
  q('select * from product_changes where product_id = $1 order by id', [id]);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  s = await startServer();
  pool = new Pool({ connectionString: s.databaseUrl });
  [admin, admin2, editor1, editor2, viewer] = await Promise.all([
    loginAs(s, 'admin'),
    loginAs(s, 'admin'),
    loginAs(s, 'editor1'),
    loginAs(s, 'editor2'),
    loginAs(s, 'viewer'),
  ]);
  all = await listProducts(s, admin);
  const cats = async (login: string) =>
    (
      await q(
        `select c.category from user_categories c join users u on u.id=c.user_id where u.login=$1`,
        [login],
      )
    ).map((r) => r.category as string);
  e1Cats = await cats('editor1');
  e2Cats = await cats('editor2');
}, 90_000);
afterAll(async () => {
  await pool?.end();
  await s?.stop();
});

/** Fresh active product in a category, with a price, no oldPrice: each test takes its own to stay independent. */
const used = new Set<string>();
const take = (pred: (p: ProductRow) => boolean = () => true) => {
  const p = all.find(
    (x) =>
      x.status === 'active' &&
      x.price !== null &&
      x.oldPrice === null &&
      pred(x) &&
      !used.has(x.id),
  );
  if (!p) throw new Error('ran out of seed products');
  used.add(p.id);
  return p;
};
const inCats = (cats: string[]) => (p: ProductRow) =>
  p.category !== null && cats.includes(p.category);

describe('GET /products', () => {
  it('returns all 2000 products with versions to every role, including foreign categories', async () => {
    for (const ses of [admin, editor1, viewer]) {
      const list = await listProducts(s, ses);
      expect(list).toHaveLength(2000);
      expect(list[0]!.versions.price).toBe(0);
    }
  });
  it('requires a session', async () => {
    expect((await call(s.baseUrl, 'GET', '/products')).status).toBe(401);
  });
  it('is fast enough to be loaded in one request', async () => {
    const t0 = performance.now();
    await listProducts(s, viewer);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});

describe('permissions on PATCH /products/batch', () => {
  it('unauthenticated -> 401, viewer -> 403 (nothing changes)', async () => {
    const p = take();
    const body = { changes: [{ id: p.id, field: 'stock', value: 7, baseVersion: 0 }] };
    expect((await call(s.baseUrl, 'PATCH', '/products/batch', { body })).status).toBe(401);
    const r = await patchBatch(s, viewer, body.changes);
    expect(r.status).toBe(403);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('forbidden');
    expect((await db(p.id)).stock).toBe(p.stock);
  });

  it('editor may edit own categories', async () => {
    const p = take(inCats(e1Cats));
    const r = await one(s, editor1, { id: p.id, field: 'stock', value: 11, baseVersion: 0 });
    expect(r).toMatchObject({ status: 'ok', newVersion: 1, value: 11 });
    expect((await db(p.id)).stock).toBe(11);
  });

  it('editor CANNOT edit a foreign category; DB unchanged; no history written', async () => {
    const p = take(inCats(e2Cats));
    const r = await one(s, editor1, { id: p.id, field: 'stock', value: 12345, baseVersion: 0 });
    expect(r.status).toBe('forbidden');
    expect((await db(p.id)).stock).toBe(p.stock);
    expect(await changes(p.id)).toHaveLength(0);
  });

  it('editor cannot hide a foreign edit inside a mixed batch', async () => {
    const mine = take(inCats(e1Cats));
    const theirs = take(inCats(e2Cats));
    const rs = results(
      await patchBatch(s, editor1, [
        { id: mine.id, field: 'stock', value: 21, baseVersion: 0 },
        { id: theirs.id, field: 'stock', value: 22, baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['ok', 'forbidden']);
    expect((await db(theirs.id)).stock).toBe(theirs.stock);
  });

  it('editor cannot move own product INTO a foreign category, nor clear its category', async () => {
    const p = take(inCats(e1Cats));
    const foreign = e2Cats[0]!;
    expect(
      (await one(s, editor1, { id: p.id, field: 'category', value: foreign, baseVersion: 0 }))
        .status,
    ).toBe('forbidden');
    expect(
      (await one(s, editor1, { id: p.id, field: 'category', value: null, baseVersion: 0 })).status,
    ).toBe('forbidden');
    expect((await db(p.id)).category).toBe(p.category);
  });

  it('editor can move a product between own categories', async () => {
    const p = take(inCats(e1Cats));
    const target = e1Cats.find((c) => c !== p.category)!;
    expect(
      (await one(s, editor1, { id: p.id, field: 'category', value: target, baseVersion: 0 }))
        .status,
    ).toBe('ok');
  });

  it('a foreign-category change smuggled with an otherwise valid own change rolls nothing wrong', async () => {
    // editor1 owns p, but tries to change p's sku to something AND category to foreign in the same product group
    const p = take(inCats(e1Cats));
    const rs = results(
      await patchBatch(s, editor1, [
        { id: p.id, field: 'stock', value: 31, baseVersion: 0 },
        { id: p.id, field: 'category', value: e2Cats[0], baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['rolled_back', 'forbidden']);
    expect((await db(p.id)).stock).toBe(p.stock); // atomic: the harmless part did not slip through either
  });

  it('admin can edit any category', async () => {
    const p = take(inCats(e2Cats));
    expect(
      (await one(s, admin, { id: p.id, field: 'stock', value: 5, baseVersion: 0 })).status,
    ).toBe('ok');
  });

  it('editors cannot touch products without a category (only admin)', async () => {
    const [p] = pick(all, (x) => x.category === null && x.status !== 'active');
    expect(
      (await one(s, editor1, { id: p!.id, field: 'stock', value: 1, baseVersion: 0 })).status,
    ).toBe('forbidden');
    expect(
      (await one(s, admin, { id: p!.id, field: 'stock', value: 1, baseVersion: 0 })).status,
    ).toBe('ok');
  });
});

describe('versions per field', () => {
  it('different fields of one product changed concurrently by two users: both succeed', async () => {
    const p = take();
    const [a, b] = await Promise.all([
      one(s, admin, { id: p.id, field: 'price', value: '777.00', baseVersion: 0 }),
      one(s, admin2, { id: p.id, field: 'stock', value: 777, baseVersion: 0 }),
    ]);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    const row = await db(p.id);
    expect(row.price).toBe('777.00');
    expect(row.stock).toBe(777);
    expect(row.versions).toMatchObject({ price: 1, stock: 1, name: 0 });
  });

  it('same field: second writer gets a conflict with the current value and the author', async () => {
    const p = take();
    expect(
      (await one(s, admin, { id: p.id, field: 'name', value: 'Winner', baseVersion: 0 })).status,
    ).toBe('ok');
    const r = await one(s, admin2, { id: p.id, field: 'name', value: 'Loser', baseVersion: 0 });
    expect(r).toMatchObject({
      status: 'conflict',
      currentValue: 'Winner',
      currentVersion: 1,
      author: { login: 'admin' },
    });
    expect((await db(p.id)).name).toBe('Winner');
  });

  it('a conflict does not block the other changes of the same product or other products', async () => {
    const [a, b] = [take(), take()];
    await one(s, admin, { id: a.id, field: 'name', value: 'First', baseVersion: 0 });
    const rs = results(
      await patchBatch(s, admin2, [
        { id: a.id, field: 'name', value: 'Second', baseVersion: 0 }, // conflicts
        { id: a.id, field: 'stock', value: 99, baseVersion: 0 }, // fine, same product
        { id: b.id, field: 'name', value: 'Other', baseVersion: 0 }, // fine, other product
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['conflict', 'ok', 'ok']);
    const row = await db(a.id);
    expect(row.name).toBe('First');
    expect(row.stock).toBe(99);
  });

  it('writing the value that is already there is a no-op, not a conflict, and leaves no history', async () => {
    const p = take();
    await one(s, admin, { id: p.id, field: 'stock', value: 41, baseVersion: 0 });
    const r = await one(s, admin2, { id: p.id, field: 'stock', value: 41, baseVersion: 0 });
    expect(r).toMatchObject({ status: 'ok', newVersion: 1 });
    expect(await changes(p.id)).toHaveLength(1);
  });

  it('a baseVersion from the future is rejected as a conflict (cannot be trusted)', async () => {
    const p = take();
    expect(
      (await one(s, admin, { id: p.id, field: 'stock', value: 1000, baseVersion: 99 })).status,
    ).toBe('conflict');
  });

  it('30 simultaneous writers with the same baseVersion: exactly one wins, version bumps once', async () => {
    const p = take();
    const rs = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        one(s, i % 2 ? admin : admin2, {
          id: p.id,
          field: 'stock',
          value: 1000 + i,
          baseVersion: 0,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'conflict')).toHaveLength(29);
    expect((await db(p.id)).versions.stock).toBe(1);
    const rows = await changes(p.id);
    expect(rows.map((r) => [r.field, r.version, r.new_value])).toEqual([
      ['stock', 1, expect.anything()],
    ]);
  });

  it('GET /products reflects the new versions', async () => {
    const p = take();
    await one(s, admin, { id: p.id, field: 'price', value: '5.55', baseVersion: 0 });
    const again = (await listProducts(s, viewer)).find((x) => x.id === p.id)!;
    expect(again.price).toBe('5.55');
    expect(again.versions.price).toBe(1);
    expect(again.versions.stock).toBe(0);
  });
});

describe('atomic per product + cross-field rules on the final state', () => {
  it('one invalid change rolls back the other changes of that product only', async () => {
    const [a, b] = [take(), take()];
    const rs = results(
      await patchBatch(s, admin, [
        { id: a.id, field: 'price', value: '55.00', baseVersion: 0 },
        { id: a.id, field: 'stock', value: -5, baseVersion: 0 }, // invalid
        { id: b.id, field: 'stock', value: 3, baseVersion: 0 }, // unrelated product: must succeed
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['rolled_back', 'invalid', 'ok']);
    expect((await db(a.id)).price).toBe(a.price);
    expect((await changes(a.id)).length).toBe(0);
    expect((await db(b.id)).stock).toBe(3);
  });

  it('oldPrice must exceed price: equal and lower are rejected, higher accepted', async () => {
    const p = take();
    const price = p.price!;
    for (const bad of [price, '0.01']) {
      const r = await one(s, admin, { id: p.id, field: 'oldPrice', value: bad, baseVersion: 0 });
      expect(r.status).toBe('invalid');
    }
    expect(await changes(p.id)).toHaveLength(0);
    const higher = (Number(price) + 1).toFixed(2);
    expect(
      (await one(s, admin, { id: p.id, field: 'oldPrice', value: higher, baseVersion: 0 })).status,
    ).toBe('ok');
  });

  it('raising price above an existing oldPrice is rejected, and the issue points at the real field', async () => {
    const p = take();
    const old = (Number(p.price) + 10).toFixed(2);
    await one(s, admin, { id: p.id, field: 'oldPrice', value: old, baseVersion: 0 });
    const r = await one(s, admin, {
      id: p.id,
      field: 'price',
      value: (Number(old) + 1).toFixed(2),
      baseVersion: 0,
    });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues.map((i) => i.field)).toContain('oldPrice');
  });

  it('validates the FINAL state: price and oldPrice moved together are fine though each alone would be invalid', async () => {
    const p = take();
    const old = (Number(p.price) + 10).toFixed(2);
    await one(s, admin, { id: p.id, field: 'oldPrice', value: old, baseVersion: 0 });
    const rs = results(
      await patchBatch(s, admin, [
        { id: p.id, field: 'price', value: '5000.00', baseVersion: 1 - 1 }, // price still at version 0
        { id: p.id, field: 'oldPrice', value: '6000.00', baseVersion: 1 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(await db(p.id)).toMatchObject({ price: '5000.00', old_price: '6000.00' });
  });

  it('active requires price and category', async () => {
    const [d] = pick(all, (x) => x.status === 'draft' && x.price === null && x.category === null);
    const r = await one(s, admin, { id: d!.id, field: 'status', value: 'active', baseVersion: 0 });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid')
      expect(r.issues.map((i) => i.code).sort()).toEqual([
        'activeRequiresCategory',
        'activeRequiresPrice',
      ]);
    expect((await db(d!.id)).status).toBe('draft');
  });

  it('...but price + category + status=active in one batch is valid (final state)', async () => {
    const [d] = pick(
      all,
      (x) => x.status === 'draft' && x.price === null && x.category === null,
      1,
      1,
    );
    const rs = results(
      await patchBatch(s, admin, [
        { id: d!.id, field: 'status', value: 'active', baseVersion: 0 },
        { id: d!.id, field: 'price', value: '9.99', baseVersion: 0 },
        { id: d!.id, field: 'category', value: 'books', baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('clearing price or category of an ACTIVE product is rejected', async () => {
    const p = take();
    expect(
      (await one(s, admin, { id: p.id, field: 'price', value: null, baseVersion: 0 })).status,
    ).toBe('invalid');
    expect(
      (await one(s, admin, { id: p.id, field: 'category', value: null, baseVersion: 0 })).status,
    ).toBe('invalid');
    const row = await db(p.id);
    expect(row.price).toBe(p.price);
    expect(row.category).toBe(p.category);
  });

  it('clearing price while also archiving the product is fine (final state is valid)', async () => {
    const p = take();
    const rs = results(
      await patchBatch(s, admin, [
        { id: p.id, field: 'price', value: null, baseVersion: 0 },
        { id: p.id, field: 'status', value: 'archived', baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['ok', 'ok']);
  });
});

describe('SKU uniqueness', () => {
  it('rejects a SKU that exists in the database', async () => {
    const [a, b] = [take(), take()];
    const r = await one(s, admin, { id: a.id, field: 'sku', value: b.sku, baseVersion: 0 });
    expect(r).toMatchObject({ status: 'invalid' });
    expect((await db(a.id)).sku).toBe(a.sku);
  });
  it('inside one batch two products claiming the same new SKU: the first wins, the second is invalid', async () => {
    const [a, b] = [take(), take()];
    const rs = results(
      await patchBatch(s, admin, [
        { id: a.id, field: 'sku', value: 'DUP-IN-BATCH', baseVersion: 0 },
        { id: b.id, field: 'sku', value: 'DUP-IN-BATCH', baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['ok', 'invalid']);
    expect((await q(`select count(*)::int n from products where sku='DUP-IN-BATCH'`))[0].n).toBe(1);
  });
  it('two parallel requests racing for one SKU: exactly one wins, never a 5xx', async () => {
    const [a, b] = [take(), take()];
    const rs = await Promise.all([
      patchBatch(s, admin, [{ id: a.id, field: 'sku', value: 'RACE-SKU', baseVersion: 0 }]),
      patchBatch(s, admin2, [{ id: b.id, field: 'sku', value: 'RACE-SKU', baseVersion: 0 }]),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const st = rs.map((r) => results(r)[0]!.status).sort();
    expect(st).toEqual(['invalid', 'ok']);
  });
  it('trims and validates SKU format', async () => {
    const p = take();
    expect(
      (await one(s, admin, { id: p.id, field: 'sku', value: 'has space', baseVersion: 0 })).status,
    ).toBe('invalid');
    expect(
      (
        await one(s, admin, {
          id: p.id,
          field: 'sku',
          value: "x'; DROP TABLE products;--",
          baseVersion: 0,
        })
      ).status,
    ).toBe('invalid');
    expect(
      await one(s, admin, { id: p.id, field: 'sku', value: '  TRIMMED-1  ', baseVersion: 0 }),
    ).toMatchObject({ status: 'ok', value: 'TRIMMED-1' });
  });
});

describe('malformed and hostile batches are always 4xx (never 5xx) and never partially apply', () => {
  const idOf = () => take().id;
  it('0 and 1001 changes', async () => {
    expect((await patchBatch(s, admin, [])).status).toBe(400);
    const id = idOf();
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id,
      field: 'stock',
      value: i,
      baseVersion: 0,
    }));
    expect((await patchBatch(s, admin, many)).status).toBe(400);
  });
  it('same product+field twice in one batch is a 400', async () => {
    const id = idOf();
    const r = await patchBatch(s, admin, [
      { id, field: 'stock', value: 1, baseVersion: 0 },
      { id, field: 'stock', value: 2, baseVersion: 0 },
    ]);
    expect(r.status).toBe(400);
    expect((await db(id)).stock).not.toBe(1);
  });
  it.each([
    ['unknown field', { field: 'password', value: 'x' }],
    ['id as field', { field: 'id', value: 'x' }],
    ['__proto__ field', { field: '__proto__', value: 'x' }],
    ['constructor field', { field: 'constructor', value: 'x' }],
    ['negative baseVersion', { field: 'stock', value: 1, baseVersion: -1 }],
    ['fractional baseVersion', { field: 'stock', value: 1, baseVersion: 0.5 }],
    ['string baseVersion', { field: 'stock', value: 1, baseVersion: '0' }],
    ['huge baseVersion', { field: 'stock', value: 1, baseVersion: 1e30 }],
    ['missing value key', { field: 'stock', baseVersion: 0 }],
  ])('%s', async (_n, patch) => {
    const id = idOf();
    const r = await call(s.baseUrl, 'PATCH', '/products/batch', {
      cookie: admin.cookie,
      body: { changes: [{ id, baseVersion: 0, ...patch }] },
    });
    expect(r.status).toBeLessThan(500);
    expect(r.status).toBeGreaterThanOrEqual(200);
    if (r.status === 200) expect(results(r)[0]!.status).not.toBe('ok');
  });
  it.each([
    ['not-a-uuid', 'nope'],
    ['SQL in id', "1' OR '1'='1"],
    ['empty id', ''],
  ])('bad product id (%s) -> 400', async (_n, id) => {
    expect(
      (await patchBatch(s, admin, [{ id, field: 'stock', value: 1, baseVersion: 0 }])).status,
    ).toBe(400);
  });
  it('unknown but well-formed product id -> per-change not_found, others unaffected', async () => {
    const p = take();
    const rs = results(
      await patchBatch(s, admin, [
        { id: '00000000-0000-4000-8000-000000000000', field: 'stock', value: 1, baseVersion: 0 },
        { id: p.id, field: 'stock', value: 2, baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['not_found', 'ok']);
  });
  it.each([
    ['price', 10],
    ['price', '0'],
    ['price', '-5'],
    ['price', '1e3'],
    ['price', '1.005'],
    ['price', '1'.repeat(40)],
    ['price', { $gt: 0 }],
    ['price', [1]],
    ['stock', '5'],
    ['stock', 1.5],
    ['stock', -1],
    ['stock', 2 ** 53],
    ['stock', null],
    ['name', ''],
    ['name', '   '],
    ['name', 'x'.repeat(201)],
    ['name', null],
    ['name', 123],
    ['status', 'ACTIVE'],
    ['status', null],
    ['category', 'not-a-category'],
    ['category', 5],
    ['tags', 'a,b'],
    ['tags', [1, 2]],
    ['tags', ['a', 'a']],
    ['tags', Array.from({ length: 21 }, (_, i) => `t${i}`)],
    ['arrivalDate', '2024-02-30'],
    ['arrivalDate', '31/12/2024'],
    ['arrivalDate', 20240101],
    ['arrivalDate', '2024-01-01T00:00:00Z'],
    ['sku', ''],
    ['sku', 5],
  ])('invalid %s = %j is reported as invalid and nothing is written', async (field, value) => {
    const p = take();
    const r = await one(s, admin, { id: p.id, field, value, baseVersion: 0 });
    expect(r.status).toBe('invalid');
    expect(await changes(p.id)).toHaveLength(0);
  });
  it('value that is a huge/nested structure is handled, not crashed on', async () => {
    const p = take();
    let nested: unknown = 'x';
    for (let i = 0; i < 200; i++) nested = [nested];
    expect(
      (await one(s, admin, { id: p.id, field: 'tags', value: nested, baseVersion: 0 })).status,
    ).toBe('invalid');
  });
  it('fuzz: random JSON bodies never produce a 5xx', async () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const atoms: unknown[] = [
      null,
      true,
      0,
      -1,
      1.5,
      1e308,
      '',
      'x',
      'x'.repeat(300),
      [],
      {},
      [null],
      { a: 1 },
      '00000000-0000-4000-8000-000000000000',
    ];
    const gen = (d = 0): unknown =>
      d > 3 || Math.random() < 0.4
        ? atoms[rnd(atoms.length)]
        : Math.random() < 0.5
          ? Array.from({ length: rnd(4) }, () => gen(d + 1))
          : Object.fromEntries(
              ['changes', 'id', 'field', 'value', 'baseVersion', 'source']
                .slice(rnd(3))
                .map((k) => [k, gen(d + 1)]),
            );
    const bad: unknown[] = [];
    for (let i = 0; i < 120; i++) {
      const body = Math.random() < 0.5 ? { changes: [gen(), gen()], source: gen() } : gen();
      const r = await call(s.baseUrl, 'PATCH', '/products/batch', { cookie: admin.cookie, body });
      if (r.status >= 500) bad.push(body);
    }
    expect(bad).toEqual([]);
  }, 60_000);
  it('an invalid Idempotency-Key header is a 400', async () => {
    const id = idOf();
    for (const key of ['short', 'has space!!!!!', 'x'.repeat(200), 'a/b/c/d/e/f/g']) {
      const r = await call(s.baseUrl, 'PATCH', '/products/batch', {
        cookie: admin.cookie,
        headers: { 'idempotency-key': key },
        body: { changes: [{ id, field: 'stock', value: 1, baseVersion: 0 }] },
      });
      expect(r.status, key).toBe(400);
    }
  });
  it('a 1000-change batch across 1000 products completes in reasonable time', async () => {
    const ps = (await listProducts(s, admin)).slice(1000, 2000);
    const t0 = performance.now();
    const r = await patchBatch(
      s,
      admin,
      ps.map((p, i) => ({
        id: p.id,
        field: 'stock',
        value: 5000 + i,
        baseVersion: p.versions.stock,
      })),
      { source: 'paste' },
    );
    const rs = results(r);
    expect(rs.filter((x) => x.status === 'ok').length).toBe(1000);
    expect(performance.now() - t0).toBeLessThan(20_000);
  }, 40_000);
});

describe('the largest VALID request is accepted (body limit)', () => {
  it('1000 changes of 20 tags x 50 Cyrillic characters (> 2 MB of JSON) is a 200, not a 413', async () => {
    const ps = (await listProducts(s, admin)).slice(1000, 2000);
    const tag = (i: number, k: number) =>
      `${String(i).padStart(4, '0')}${String(k).padStart(2, '0')}`.padEnd(50, 'ж');
    const body = ps.map((p, i) => ({
      id: p.id,
      field: 'tags' as const,
      value: Array.from({ length: 20 }, (_, k) => tag(i, k)),
      baseVersion: p.versions.tags,
    }));
    expect(Buffer.byteLength(JSON.stringify({ changes: body }))).toBeGreaterThan(2_000_000);
    const r = await patchBatch(s, admin, body, { source: 'paste' });
    expect(r.status).toBe(200);
    expect(results(r).filter((x) => x.status === 'ok')).toHaveLength(1000);
  }, 60_000);
});

describe('idempotency', () => {
  const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  it('replaying the same batch with the same key applies it once and returns the same response', async () => {
    const p = take();
    const k = key();
    const c = [{ id: p.id, field: 'stock', value: 321, baseVersion: 0 }];
    const first = await patchBatch(s, admin, c, { key: k });
    const second = await patchBatch(s, admin, c, { key: k });
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect((await db(p.id)).versions.stock).toBe(1);
    expect(await changes(p.id)).toHaveLength(1);
  });

  it('without a key the same retry is NOT deduplicated (it would conflict) - which is why the key exists', async () => {
    const p = take();
    const c = [{ id: p.id, field: 'stock', value: 322, baseVersion: 0 }];
    await patchBatch(s, admin, c);
    // same value -> no-op; use a different value to prove staleness
    const retry = results(await patchBatch(s, admin, [{ ...c[0]!, value: 323 }]));
    expect(retry[0]!.status).toBe('conflict');
  });

  it('same key, different body -> 422; the second body is NOT applied', async () => {
    const p = take();
    const k = key();
    await patchBatch(s, admin, [{ id: p.id, field: 'stock', value: 1, baseVersion: 0 }], {
      key: k,
    });
    const r = await patchBatch(s, admin, [{ id: p.id, field: 'stock', value: 2, baseVersion: 1 }], {
      key: k,
    });
    expect(r.status).toBe(422);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('idempotency_key_reused');
    expect((await db(p.id)).stock).toBe(1);
  });

  it('key order inside the body does not matter (canonical hash)', async () => {
    const p = take();
    const k = key();
    const a = await call(s.baseUrl, 'PATCH', '/products/batch', {
      cookie: admin.cookie,
      headers: { 'idempotency-key': k },
      rawBody: `{"changes":[{"id":"${p.id}","field":"stock","value":9,"baseVersion":0}]}`,
    });
    const b = await call(s.baseUrl, 'PATCH', '/products/batch', {
      cookie: admin.cookie,
      headers: { 'idempotency-key': k },
      rawBody: `{"changes":[{"baseVersion":0,"value":9,"field":"stock","id":"${p.id}"}]}`,
    });
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });

  it('10 simultaneous identical requests: applied once, all ten responses identical', async () => {
    const p = take();
    const k = key();
    const c = [
      { id: p.id, field: 'stock', value: 555, baseVersion: 0 },
      { id: p.id, field: 'name', value: 'Concurrent', baseVersion: 0 },
    ];
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => patchBatch(s, admin, c, { key: k })),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    for (const r of rs) expect(r.body).toEqual(rs[0]!.body);
    expect(rs.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
    const row = await db(p.id);
    expect(row.versions).toMatchObject({ stock: 1, name: 1 });
    expect(await changes(p.id)).toHaveLength(2);
  });

  it('keys are per user: another user with the same key is independent', async () => {
    const [a, b] = [take(), take()];
    const k = key();
    await patchBatch(s, admin, [{ id: a.id, field: 'stock', value: 1, baseVersion: 0 }], {
      key: k,
    });
    const r = await patchBatch(
      s,
      editor1,
      [{ id: b.id, field: 'stock', value: 2, baseVersion: 0 }],
      { key: k },
    );
    // editor1 may or may not own b, but must not get admin's cached response nor a 422
    expect(r.status).toBe(200);
    expect(r.headers['idempotent-replayed']).toBeUndefined();
  });

  it('a request that fails before processing (403 for a viewer) does not burn the key', async () => {
    const p = take();
    const k = key();
    expect(
      (
        await patchBatch(s, viewer, [{ id: p.id, field: 'stock', value: 1, baseVersion: 0 }], {
          key: k,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await patchBatch(s, viewer, [{ id: p.id, field: 'stock', value: 1, baseVersion: 0 }], {
          key: k,
        })
      ).status,
    ).toBe(403);
  });

  it('a replay returns the stored response even if the data has since changed', async () => {
    const p = take();
    const k = key();
    const c = [{ id: p.id, field: 'stock', value: 70, baseVersion: 0 }];
    const first = await patchBatch(s, admin, c, { key: k });
    await one(s, admin2, { id: p.id, field: 'stock', value: 71, baseVersion: 1 });
    const replay = await patchBatch(s, admin, c, { key: k });
    expect(replay.body).toEqual(first.body);
    expect((await db(p.id)).stock).toBe(71);
  });

  it('a stuck in-progress key (crashed owner) is taken over after the stale timeout', async () => {
    const p = take();
    const k = key();
    const c = [{ id: p.id, field: 'stock', value: 88, baseVersion: 0 }];
    const { hashBody } = await import('../src/products/idempotency.service');
    const me = (await call(s.baseUrl, 'GET', '/me', { cookie: admin.cookie })).body as {
      id: string;
    };
    await pool.query(
      `insert into idempotency_keys (user_id, key, request_hash, state, created_at) values ($1,$2,$3,'in_progress', now() - interval '5 minutes')`,
      [me.id, k, hashBody({ changes: c, source: 'edit' })],
    );
    const r = await patchBatch(s, admin, c, { key: k });
    expect(r.status).toBe(200);
    expect((await db(p.id)).stock).toBe(88);
  });
});

describe('history', () => {
  it('records who, when, old/new value, source and field version for every applied change', async () => {
    const p = take();
    const owner = all.find((x) => x.id === p.id)!;
    const who = e1Cats.includes(owner.category ?? '') ? editor1 : admin;
    await patchBatch(s, who, [{ id: p.id, field: 'stock', value: 12, baseVersion: 0 }], {
      source: 'paste',
    });
    await patchBatch(s, who, [{ id: p.id, field: 'stock', value: 13, baseVersion: 1 }], {
      source: 'fill',
    });
    const r = await history(s, viewer, p.id); // viewers can read history
    expect(r.status).toBe(200);
    const { entries } = historyResponseSchema.parse(r.body);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      field: 'stock',
      oldValue: 12,
      newValue: 13,
      version: 2,
      source: 'fill',
      author: { login: who.login },
    });
    expect(entries[1]).toMatchObject({
      oldValue: p.stock,
      newValue: 12,
      version: 1,
      source: 'paste',
    });
    expect(Date.now() - new Date(entries[0]!.createdAt).getTime()).toBeLessThan(60_000);
  });

  it('?field filters; ?limit is bounded; bad params are 400', async () => {
    const p = take();
    await patchBatch(s, admin, [
      { id: p.id, field: 'stock', value: 1, baseVersion: 0 },
      { id: p.id, field: 'name', value: 'H', baseVersion: 0 },
    ]);
    const only = historyResponseSchema.parse(
      (await history(s, admin, p.id, '?field=name')).body,
    ).entries;
    expect(only.map((e) => e.field)).toEqual(['name']);
    expect((await history(s, admin, p.id, '?limit=1')).body).toMatchObject({
      entries: [expect.anything()],
    });
    for (const bad of ['?limit=0', '?limit=100000', '?limit=abc', '?field=nope']) {
      expect((await history(s, admin, p.id, bad)).status, bad).toBe(400);
    }
  });

  it('bad / unknown product ids: 400 / 404; unauthenticated 401', async () => {
    expect((await history(s, admin, 'nope')).status).toBe(400);
    expect((await history(s, admin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await call(s.baseUrl, 'GET', `/products/${take().id}/history`)).status).toBe(401);
  });

  it('is written in the SAME transaction as the change: if the history insert fails, the update is rolled back', async () => {
    const p = take();
    await pool.query(`
      create or replace function fail_history() returns trigger as $$
      begin raise exception 'simulated history failure'; end $$ language plpgsql;
      create trigger fail_history_t before insert on product_changes
        for each row when (new.new_value = '"TRIGGER-BOOM"'::jsonb) execute function fail_history();`);
    try {
      const r = await patchBatch(s, admin, [
        { id: p.id, field: 'name', value: 'TRIGGER-BOOM', baseVersion: 0 },
      ]);
      // an internal fault on one product is reported for THAT product (the batch is not failed as a whole)...
      expect(r.status).toBe(200);
      expect(results(r)[0]).toMatchObject({
        status: 'invalid',
        issues: [{ code: 'internal_error' }],
      });
      const row = await db(p.id);
      expect(row.name).toBe(p.name); // ...and it must not leave a half-applied change behind
      expect(row.versions.name ?? 0).toBe(0);
      expect(await changes(p.id)).toHaveLength(0);
    } finally {
      await pool.query(
        'drop trigger fail_history_t on product_changes; drop function fail_history()',
      );
    }
  });

  it('failed changes (invalid, conflict, forbidden) leave no history', async () => {
    const p = take(inCats(e2Cats));
    await one(s, editor1, { id: p.id, field: 'stock', value: 1, baseVersion: 0 });
    await one(s, admin, { id: p.id, field: 'stock', value: -1, baseVersion: 0 });
    expect(await changes(p.id)).toHaveLength(0);
  });
});

describe('restore from history', () => {
  const lastEntry = async (id: string, field?: string) =>
    historyResponseSchema.parse((await history(s, admin, id, field ? `?field=${field}` : '')).body)
      .entries[0]!;
  const restore = (ses: Session, changeId: string, baseVersion: number) =>
    call(s.baseUrl, 'POST', `/history/${encodeURIComponent(changeId)}/restore`, {
      cookie: ses.cookie,
      body: { baseVersion },
    });

  it('puts the old value back, as a normal change with source "restore"', async () => {
    const p = take();
    await one(s, admin, { id: p.id, field: 'price', value: '123.45', baseVersion: 0 });
    const e = await lastEntry(p.id);
    const r = await restore(admin, e.id, 1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: { status: 'ok', newVersion: 2, value: p.price } });
    expect((await db(p.id)).price).toBe(p.price);
    expect(await lastEntry(p.id)).toMatchObject({
      source: 'restore',
      oldValue: '123.45',
      newValue: p.price,
      version: 2,
    });
  });

  it('is subject to version conflicts', async () => {
    const p = take();
    await one(s, admin, { id: p.id, field: 'stock', value: 1, baseVersion: 0 });
    const e = await lastEntry(p.id);
    await one(s, admin2, { id: p.id, field: 'stock', value: 2, baseVersion: 1 });
    const r = await restore(admin, e.id, 1); // stale
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      error: { code: 'conflict', details: { currentValue: 2, author: { login: 'admin' } } },
    });
    expect((await db(p.id)).stock).toBe(2);
  });

  it('is subject to cross-field rules (cannot restore into an invalid state)', async () => {
    const p = take();
    const old = (Number(p.price) + 10).toFixed(2);
    await one(s, admin, { id: p.id, field: 'oldPrice', value: old, baseVersion: 0 });
    await one(s, admin, { id: p.id, field: 'oldPrice', value: null, baseVersion: 1 });
    const clearEntry = await lastEntry(p.id, 'oldPrice'); // old=old,new=null -> restore => oldPrice=old
    await one(s, admin, {
      id: p.id,
      field: 'price',
      value: (Number(old) + 50).toFixed(2),
      baseVersion: 0,
    });
    const r = await restore(admin, clearEntry.id, 2);
    expect(r.status).toBe(400);
    expect((await db(p.id)).old_price).toBeNull();
  });

  it('is subject to SKU uniqueness', async () => {
    const [a, b] = [take(), take()];
    await one(s, admin, { id: a.id, field: 'sku', value: 'RESTORE-TMP', baseVersion: 0 });
    const e = await lastEntry(a.id);
    await one(s, admin, { id: b.id, field: 'sku', value: a.sku, baseVersion: 0 }); // b takes a's old sku
    const r = await restore(admin, e.id, 1);
    expect(r.status).toBe(400);
    expect((await db(a.id)).sku).toBe('RESTORE-TMP');
  });

  it('viewer cannot restore; editor cannot restore on a foreign category (history made by admin)', async () => {
    const p = take(inCats(e2Cats));
    await one(s, admin, { id: p.id, field: 'stock', value: 3, baseVersion: 0 });
    const e = await lastEntry(p.id);
    expect((await restore(viewer, e.id, 1)).status).toBe(403);
    expect((await restore(editor1, e.id, 1)).status).toBe(403);
    expect((await db(p.id)).stock).toBe(3);
    expect((await restore(editor2, e.id, 1)).status).toBe(200); // the rightful editor may
  });

  it('editor cannot restore a category back to a foreign category', async () => {
    const p = take(inCats(e1Cats));
    const foreign = e2Cats[0]!;
    await one(s, admin, { id: p.id, field: 'category', value: foreign, baseVersion: 0 }); // admin moved it away
    await one(s, admin, { id: p.id, field: 'category', value: e1Cats[0], baseVersion: 1 }); // and back
    const e = await lastEntry(p.id, 'category'); // old=foreign, new=own -> restore would set foreign
    const r = await restore(editor1, e.id, 2);
    expect(r.status).toBe(403);
  });

  it.each([
    ['non-numeric id', 'abc', 400],
    ['sql in id', '1;drop table users', 400],
    ['negative', '-1', 400],
    ['too long', '9'.repeat(30), 400],
    ['missing', '999999999', 404],
  ])('%s -> %i', async (_n, id, status) => {
    expect((await restore(admin, id, 0)).status).toBe(status);
  });
  it('bad body -> 400', async () => {
    const r = await call(s.baseUrl, 'POST', '/history/1/restore', {
      cookie: admin.cookie,
      body: { baseVersion: 'x' },
    });
    expect(r.status).toBe(400);
  });
});

describe('one failing product does not fail the whole batch', () => {
  it('a database error on one product: 200, that product reported, every other product saved, key replayable', async () => {
    const ps = [take(), take(), take(), take()];
    // a rule only the database knows about, so the value passes request validation and fails in the transaction
    await pool.query(`alter table products add constraint test_boom check (name <> 'BOOM')`);
    try {
      const key = `boom-${Date.now()}`;
      const changesIn = ps.map((p, i) => ({
        id: p.id,
        field: 'name' as const,
        value: i === 1 ? 'BOOM' : `ok-${i}-${p.id.slice(0, 4)}`,
        baseVersion: 0,
      }));
      const r = await patchBatch(s, admin, changesIn, { key });
      expect(r.status).toBe(200); // used to be a 400 for the whole request
      const rs = results(r);
      expect(rs.map((x) => x.status)).toEqual(['ok', 'invalid', 'ok', 'ok']);
      expect((await db(ps[1]!.id)).name).toBe(ps[1]!.name); // rolled back
      for (const i of [0, 2, 3]) expect((await db(ps[i]!.id)).name).toBe(changesIn[i]!.value);
      // the key stays bound to the response: a retry returns the same result and applies nothing twice
      const again = await patchBatch(s, admin, changesIn, { key });
      expect(results(again)).toEqual(rs);
      expect((await changes(ps[0]!.id)).length).toBe(1);
    } finally {
      await pool.query(`alter table products drop constraint test_boom`);
    }
  });

  it('a SKU claimed by a product whose own change FAILED is not lost for the next product', async () => {
    const [a, b] = [take(), take()];
    // a's claim fails (stale baseVersion -> conflict), so b must be able to take the SKU
    await one(s, admin, { id: a.id, field: 'name', value: 'bumped', baseVersion: 0 });
    await one(s, admin, { id: a.id, field: 'sku', value: 'FREED-SKU-1', baseVersion: 0 }); // moves a.sku version to 1
    await one(s, admin, { id: a.id, field: 'sku', value: a.sku, baseVersion: 1 }); // back; version 2
    const rs = results(
      await patchBatch(s, admin, [
        { id: a.id, field: 'sku', value: 'FREED-SKU-2', baseVersion: 0 }, // stale -> conflict
        { id: b.id, field: 'sku', value: 'FREED-SKU-2', baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['conflict', 'ok']);
    expect((await db(b.id)).sku).toBe('FREED-SKU-2');
  });
});

describe('NUL character in text', () => {
  it('name and tags with U+0000 are refused as invalid values (not a database error), nothing changes', async () => {
    const p = take();
    const rs = results(
      await patchBatch(s, admin, [
        { id: p.id, field: 'name', value: 'a\u0000b', baseVersion: 0 },
        { id: p.id, field: 'tags', value: ['ok', 'x\u0000'], baseVersion: 0 },
      ]),
    );
    expect(rs.map((r) => r.status)).toEqual(['invalid', 'invalid']);
    expect((await db(p.id)).name).toBe(p.name);
  });
  it('a bulk job whose filter text contains NUL is a 400', async () => {
    const r = await call(s.baseUrl, 'POST', '/bulk-jobs/preview', {
      cookie: admin.cookie,
      body: { filter: { name: 'a\u0000' } },
    });
    expect(r.status).toBe(400);
  });
});
