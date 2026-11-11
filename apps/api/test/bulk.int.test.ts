import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  apiErrorSchema,
  bulkJobSchema,
  computeAdjust,
  type Category,
  type ProductFilter,
  type ProductRow,
} from '@catalog/shared';
import { startServer, type TestServer } from './helpers/server';
import { call } from './helpers/http';
import { listProducts, loginAs, one, type Session } from './helpers/api';
import { createJob, getJob, post, startJob, terminal, waitJob } from './helpers/jobs';

let s: TestServer;
let pool: Pool;
let admin: Session;
let editor1: Session;
let editor2: Session;
let viewer: Session;
let initial: ProductRow[];
let e1Cats: string[];

const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
const priceOf = async (id: string) =>
  (await q('select price from products where id=$1', [id]))[0].price as string | null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  s = await startServer({
    BULK_CHUNK_SIZE: '50',
    BULK_CHUNK_DELAY_MS: '40',
    BULK_WORKER_CONCURRENCY: '3',
    BULK_POLL_MS: '30',
  });
  pool = new Pool({ connectionString: s.databaseUrl });
  pool.on('error', () => undefined); // this suite kills backends on purpose
  [admin, editor1, editor2, viewer] = await Promise.all([
    loginAs(s, 'admin'),
    loginAs(s, 'editor1'),
    loginAs(s, 'editor2'),
    loginAs(s, 'viewer'),
  ]);
  initial = await listProducts(s, admin);
  e1Cats = (
    await q(
      `select category from user_categories c join users u on u.id=c.user_id where u.login='editor1'`,
    )
  ).map((r) => r.category);
}, 90_000);
afterAll(async () => {
  await pool?.end();
  await s?.stop();
});

const adjust = (
  amount: string,
  field: 'price' | 'oldPrice' | 'stock' = 'price',
  mode: 'percent' | 'absolute' = 'percent',
) => ({ type: 'adjust', field, mode, amount }) as const;

describe('the spec example: price +10% for a category with status active', () => {
  it('applies exactly +10% (exact decimal math) to matching products only, via history source "bulk"', async () => {
    const cat = 'books';
    const job = await startJob(s, admin, {
      filter: { category: [cat], status: ['active'] },
      operation: adjust('10'),
    });
    expect(job.total).toBe(
      initial.filter((p) => p.category === cat && p.status === 'active').length,
    );
    const done = await waitJob(s, admin, job.id, terminal);
    expect(done.status).toBe('done');
    expect(done.processed).toBe(done.total);
    expect(done.applied + done.skipped).toBe(done.total);

    for (const p of initial) {
      const now = await priceOf(p.id);
      if (p.category === cat && p.status === 'active' && p.price !== null) {
        const exp = computeAdjust('price', p.price, 'percent', '10');
        const reportedSkip = done.report.some((r) => r.productId === p.id);
        if (reportedSkip) expect(now).toBe(p.price);
        else expect(now).toBe((exp as { value: string }).value);
      } else {
        expect(now).toBe(p.price);
      }
    }
    const h = await q(`select source, job_id, user_id from product_changes where job_id = $1`, [
      job.id,
    ]);
    expect(h).toHaveLength(done.applied);
    expect(new Set(h.map((r) => r.source))).toEqual(new Set(['bulk']));
  });
});

describe('permissions', () => {
  it('viewer and anonymous cannot create/cancel/revert/preview; viewer can read', async () => {
    const body = { filter: {}, operation: adjust('1', 'stock', 'absolute') };
    expect((await call(s.baseUrl, 'POST', '/bulk-jobs', { body })).status).toBe(401);
    expect((await createJob(s, viewer, body)).status).toBe(403);
    expect((await post(s, viewer, '/bulk-jobs/preview', { filter: {} })).status).toBe(403);
    const job = await startJob(s, admin, {
      filter: { name: 'zzz-no-such-product' },
      operation: adjust('1', 'stock', 'absolute'),
    });
    expect((await post(s, viewer, `/bulk-jobs/${job.id}/cancel`)).status).toBe(403);
    expect((await post(s, viewer, `/bulk-jobs/${job.id}/revert`)).status).toBe(403);
    expect(
      (await call(s.baseUrl, 'GET', `/bulk-jobs/${job.id}`, { cookie: viewer.cookie })).status,
    ).toBe(200);
    expect((await call(s.baseUrl, 'GET', `/bulk-jobs`, { cookie: viewer.cookie })).status).toBe(
      200,
    );
  });

  it('editor over ALL products: foreign categories are skipped with a reason and never modified', async () => {
    const stockBefore = new Map(
      (await q('select id, stock, category from products')).map((r) => [r.id as string, r]),
    );
    const job = await startJob(s, editor1, {
      filter: {},
      operation: adjust('3', 'stock', 'absolute'),
    });
    const done = await waitJob(s, editor1, job.id, terminal);
    expect(done.status).toBe('done');
    const mine = initial.filter((p) => p.category && e1Cats.includes(p.category)).length;
    expect(done.applied).toBe(mine);
    expect(done.skipped).toBe(2000 - mine);
    for (const r of await q('select id, stock, category from products')) {
      const before = stockBefore.get(r.id)!;
      const own = r.category && e1Cats.includes(r.category);
      expect(r.stock).toBe(own ? before.stock + 3 : before.stock);
    }
    expect(done.report.length).toBeGreaterThan(0);
    expect(new Set(done.report.map((r) => r.reason))).toEqual(new Set(['forbidden']));
    expect(done.report[0]!.sku).toMatch(/^SKU-/);
    expect(done.report[0]!.message).toBeTruthy();
  });

  it('editor cannot set a foreign category through a bulk job', async () => {
    const own = initial
      .filter((p) => p.category && e1Cats.includes(p.category) && p.status !== 'active')
      .slice(0, 3);
    const foreign = initial.find((p) => p.category && !e1Cats.includes(p.category))!.category!;
    const job = await startJob(s, editor1, {
      filter: { sku: own[0]!.sku },
      operation: { type: 'set', field: 'category', value: foreign },
    });
    const done = await waitJob(s, editor1, job.id, terminal);
    expect(done.applied).toBe(0);
    expect((await q('select category from products where id=$1', [own[0]!.id]))[0].category).toBe(
      own[0]!.category,
    );
  });

  it('only the creator or an admin may cancel/revert', async () => {
    const job = await startJob(s, editor1, {
      filter: { category: [e1Cats[0] as Category] },
      operation: adjust('1', 'stock', 'absolute'),
    });
    expect((await post(s, editor2, `/bulk-jobs/${job.id}/cancel`)).status).toBe(403);
    await waitJob(s, editor1, job.id, terminal);
    expect((await post(s, editor2, `/bulk-jobs/${job.id}/revert`)).status).toBe(403);
    expect((await post(s, admin, `/bulk-jobs/${job.id}/revert`)).status).toBe(200); // admin may
    expect((await waitJob(s, admin, job.id, terminal)).status).toBe('reverted');
  });

  it('preview returns the match count and how many the caller may change', async () => {
    const all = await post(s, editor1, '/bulk-jobs/preview', { filter: {} });
    expect(all.body).toMatchObject({
      count: 2000,
      editable: initial.filter((p) => p.category && e1Cats.includes(p.category)).length,
    });
    expect(
      (await post(s, admin, '/bulk-jobs/preview', { filter: { status: ['draft'] } })).body,
    ).toMatchObject({
      count: initial.filter((p) => p.status === 'draft').length,
    });
  });
});

describe('operations', () => {
  it('set / absolute / tags; tags are idempotent and unchanged items are reported, not applied', async () => {
    const cat = 'toys';
    const total = initial.filter((p) => p.category === cat).length;
    let j = await waitJob(
      s,
      admin,
      (
        await startJob(s, admin, {
          filter: { category: [cat] },
          operation: { type: 'addTag', tag: 'bulk-tag' },
        })
      ).id,
      terminal,
    );
    expect(j.applied + j.skipped).toBe(total);
    const tagged = (
      await q(`select count(*)::int n from products where category=$1 and 'bulk-tag' = any(tags)`, [
        cat,
      ])
    )[0].n;
    expect(tagged).toBe(total);
    j = await waitJob(
      s,
      admin,
      (
        await startJob(s, admin, {
          filter: { category: [cat] },
          operation: { type: 'addTag', tag: 'bulk-tag' },
        })
      ).id,
      terminal,
    );
    expect(j.applied).toBe(0); // everything already has it
    expect(new Set(j.report.map((r) => r.reason))).toEqual(new Set(['unchanged']));
    j = await waitJob(
      s,
      admin,
      (
        await startJob(s, admin, {
          filter: { category: [cat] },
          operation: { type: 'removeTag', tag: 'bulk-tag' },
        })
      ).id,
      terminal,
    );
    expect(j.applied).toBe(total);
    expect(
      (await q(`select count(*)::int n from products where 'bulk-tag' = any(tags)`))[0].n,
    ).toBe(0);
  });

  it('percent that would make the price invalid is skipped per product with the reason; others applied', async () => {
    const cat = 'garden';
    const job = await startJob(s, admin, {
      filter: { category: [cat] },
      operation: adjust('-100'),
    }); // price -> 0.00 -> invalid
    const done = await waitJob(s, admin, job.id, terminal);
    expect(done.applied).toBe(0);
    expect(done.skipped).toBe(done.total);
    expect(done.report.some((r) => /price/i.test(r.message))).toBe(true);
  });

  it('respects cross-field rules: +10000% price would exceed nothing but oldPrice > price rule blocks lowering below oldPrice', async () => {
    const withOld =
      initial.find((p) => p.oldPrice !== null && p.category === 'electronics') ??
      initial.find((p) => p.oldPrice !== null)!;
    const job = await startJob(s, admin, {
      filter: { sku: withOld.sku },
      operation: { type: 'set', field: 'price', value: withOld.oldPrice },
    });
    const done = await waitJob(s, admin, job.id, terminal);
    expect(done.applied).toBe(0);
    expect(done.report[0]).toMatchObject({ reason: 'invalid', sku: withOld.sku });
    expect(await priceOf(withOld.id)).toBe(withOld.price);
  });

  it('rejects broken jobs at creation with 400 (not 2000 skipped rows)', async () => {
    const bad: unknown[] = [
      { filter: {}, operation: { type: 'set', field: 'price', value: 'abc' } },
      { filter: {}, operation: { type: 'set', field: 'status', value: 'nope' } },
      { filter: {}, operation: { type: 'set', field: 'sku', value: 'X' } },
      { filter: {}, operation: { type: 'set', field: 'id', value: 'X' } },
      { filter: {}, operation: adjust('1.5', 'stock', 'absolute') },
      { filter: {}, operation: { ...adjust('1e3') } },
      { filter: {}, operation: { type: 'adjust', field: 'name', mode: 'percent', amount: '1' } },
      { filter: {}, operation: { type: 'addTag', tag: '' } },
      { filter: {}, operation: { type: 'addTag', tag: 'x'.repeat(51) } },
      { filter: { category: ['nope'] }, operation: { type: 'addTag', tag: 'a' } },
      { filter: { category: Array(21).fill('books') }, operation: { type: 'addTag', tag: 'a' } },
      { filter: { priceMin: '1; drop table products' }, operation: { type: 'addTag', tag: 'a' } },
      { filter: { name: { $ne: 1 } }, operation: { type: 'addTag', tag: 'a' } },
      { operation: { type: 'addTag', tag: 'a' } },
      { filter: {} },
      null,
      [],
    ];
    for (const b of bad) {
      const r = await createJob(s, admin, b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      apiErrorSchema.parse(r.body);
    }
  });

  it('a job over zero products finishes immediately', async () => {
    const job = await startJob(s, admin, {
      filter: { name: 'no-product-has-this-name-xyz' },
      operation: { type: 'addTag', tag: 'a' },
    });
    const done = await waitJob(s, admin, job.id, terminal);
    expect(done).toMatchObject({ status: 'done', total: 0, applied: 0 });
  });
});

describe('filter semantics: SQL equals the shared predicate (and cannot be injected)', () => {
  it('agrees on many filters, including LIKE metacharacters and quotes', async () => {
    const { matchesFilter } = await import('@catalog/shared');
    const filters: ProductFilter[] = [
      {},
      { name: 'lamp' },
      { name: 'LAMP' },
      { sku: '0004' },
      { name: '%' },
      { name: '_' },
      { name: '\\' },
      { name: "'; drop table products; --" },
      { name: 'é' },
      { category: ['books', 'toys'] },
      { status: ['draft', 'archived'] },
      { priceMin: '100', priceMax: '500' },
      { priceMin: '9.99' },
      { priceMax: '0.01' },
      { stockMin: 100, stockMax: 200 },
      { category: ['books'], status: ['active'], priceMin: '50' },
    ];
    const fresh = await listProducts(s, admin); // earlier tests changed prices
    for (const f of filters) {
      const expected = fresh.filter((p) => matchesFilter(p, f)).length;
      const r = await post(s, admin, '/bulk-jobs/preview', { filter: f });
      expect(r.body, JSON.stringify(f)).toMatchObject({ count: expected });
    }
    expect((await q('select count(*)::int n from products'))[0].n).toBe(2000);
  });
});

describe('progress, chunks and cancel', () => {
  it('reports progress in parts while running and ends with processed == total', async () => {
    const job = await startJob(s, admin, {
      filter: {},
      operation: adjust('1', 'stock', 'absolute'),
    });
    const seen: number[] = [];
    await waitJob(s, admin, job.id, (j) => {
      seen.push(j.processed);
      return terminal(j);
    });
    const mid = seen.filter((n) => n > 0 && n < 2000);
    expect(mid.length).toBeGreaterThan(2); // genuinely chunked, not one big step
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // monotonic
    expect(new Set(seen.filter((n) => n % 50 !== 0 && n !== 2000)).size).toBe(0); // only whole chunks are visible
  });

  it('cancel mid-way: the applied part stays, the rest is never applied, nothing half-applied', async () => {
    const before = new Map(
      (await q('select id, stock from products')).map((r) => [r.id as string, r.stock as number]),
    );
    const job = await startJob(s, admin, {
      filter: {},
      operation: adjust('7', 'stock', 'absolute'),
    });
    await waitJob(s, admin, job.id, (j) => j.processed >= 100);
    const c = await post(s, admin, `/bulk-jobs/${job.id}/cancel`);
    expect(c.status).toBe(200);
    const done = await waitJob(s, admin, job.id, (j) => j.status === 'cancelled');
    expect(done.processed).toBeLessThan(2000);
    expect(done.processed).toBeGreaterThanOrEqual(100);
    const changed = (await q('select id, stock from products')).filter(
      (r) => r.stock !== before.get(r.id),
    );
    expect(changed).toHaveLength(done.applied);
    for (const r of changed) expect(r.stock).toBe(before.get(r.id)! + 7);
    // later nothing sneaks in
    await new Promise((r) => setTimeout(r, 300));
    expect((await getJob(s, admin, job.id)).processed).toBe(done.processed);
    // cancel is idempotent; a finished job cannot be cancelled
    expect((await post(s, admin, `/bulk-jobs/${job.id}/cancel`)).status).toBe(200);
    const fin = await startJob(s, admin, {
      filter: { name: 'nothing-matches-this' },
      operation: adjust('1', 'stock', 'absolute'),
    });
    await waitJob(s, admin, fin.id, terminal);
    expect((await post(s, admin, `/bulk-jobs/${fin.id}/cancel`)).status).toBe(409);
  });

  it('bad / unknown job ids', async () => {
    expect((await call(s.baseUrl, 'GET', '/bulk-jobs/nope', { cookie: admin.cookie })).status).toBe(
      400,
    );
    expect(
      (
        await call(s.baseUrl, 'GET', '/bulk-jobs/00000000-0000-4000-8000-000000000000', {
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (await post(s, admin, '/bulk-jobs/00000000-0000-4000-8000-000000000000/cancel')).status,
    ).toBe(404);
    expect(
      (await post(s, admin, '/bulk-jobs/00000000-0000-4000-8000-000000000000/revert')).status,
    ).toBe(404);
    expect((await post(s, admin, "/bulk-jobs/x'--/revert")).status).toBeLessThan(500);
  });
});

describe('revert', () => {
  it('puts everything back; cells changed after the job are left alone and reported', async () => {
    const cat = 'shoes';
    const before = new Map(
      (await q('select id, price from products where category=$1', [cat])).map((r) => [
        r.id as string,
        r.price as string | null,
      ]),
    );
    const job = await startJob(s, admin, {
      filter: { category: [cat], status: ['active'] },
      operation: adjust('20'),
    });
    const done = await waitJob(s, admin, job.id, terminal);
    expect(done.applied).toBeGreaterThan(5);
    // someone else edits two of the touched cells afterwards
    const touched = (
      await q(`select product_id from product_changes where job_id=$1 order by id limit 2`, [
        job.id,
      ])
    ).map((r) => r.product_id as string);
    const cur = await listProducts(s, admin);
    for (const id of touched) {
      const p = cur.find((x) => x.id === id)!;
      expect(
        (await one(s, admin, { id, field: 'price', value: '1.23', baseVersion: p.versions.price }))
          .status,
      ).toBe('ok');
    }
    expect((await post(s, admin, `/bulk-jobs/${job.id}/revert`)).status).toBe(200);
    const rev = await waitJob(s, admin, job.id, (j) => j.status === 'reverted');
    expect(rev.revertedCount).toBe(done.applied - 2);
    expect(rev.revertReport).toHaveLength(2);
    expect(new Set(rev.revertReport.map((r) => r.reason))).toEqual(new Set(['changed_since']));
    for (const [id, price] of before) {
      const now = await priceOf(id);
      if (touched.includes(id))
        expect(now).toBe('1.23'); // the later edit survived
      else expect(now).toBe(price);
    }
    const hist = await q(`select source from product_changes where job_id=$1 and source='revert'`, [
      job.id,
    ]);
    expect(hist).toHaveLength(done.applied - 2);
    // a reverted job cannot be reverted again
    expect((await post(s, admin, `/bulk-jobs/${job.id}/revert`)).status).toBe(409);
  });

  it('a cancelled job reverts only the part that was applied', async () => {
    const before = new Map(
      (await q('select id, stock from products')).map((r) => [r.id as string, r.stock as number]),
    );
    const job = await startJob(s, admin, {
      filter: {},
      operation: adjust('11', 'stock', 'absolute'),
    });
    await waitJob(s, admin, job.id, (j) => j.processed >= 100);
    await post(s, admin, `/bulk-jobs/${job.id}/cancel`);
    const cancelled = await waitJob(s, admin, job.id, (j) => j.status === 'cancelled');
    await post(s, admin, `/bulk-jobs/${job.id}/revert`);
    const rev = await waitJob(s, admin, job.id, (j) => j.status === 'reverted');
    expect(rev.revertedCount).toBe(cancelled.applied);
    for (const r of await q('select id, stock from products'))
      expect(r.stock).toBe(before.get(r.id));
  });

  it('cannot revert a job that is still running; double revert while reverting is idempotent', async () => {
    const job = await startJob(s, admin, {
      filter: {},
      operation: adjust('1', 'stock', 'absolute'),
    });
    expect((await post(s, admin, `/bulk-jobs/${job.id}/revert`)).status).toBe(409);
    await waitJob(s, admin, job.id, terminal);
    const [a, b] = await Promise.all([
      post(s, admin, `/bulk-jobs/${job.id}/revert`),
      post(s, admin, `/bulk-jobs/${job.id}/revert`),
    ]);
    expect([a.status, b.status].every((c) => c === 200 || c === 409)).toBe(true);
    expect(await waitJob(s, admin, job.id, (j) => j.status === 'reverted')).toMatchObject({
      revertedCount: 2000,
    });
  });

  it('a revert that would break a cross-field rule skips that product (reported as invalid)', async () => {
    const [p] = initial.filter(
      (x) =>
        x.category === 'tools' && x.status === 'active' && x.price !== null && x.oldPrice === null,
    );
    const job = await startJob(s, admin, {
      filter: { sku: p!.sku },
      operation: { type: 'set', field: 'price', value: '1.00' },
    });
    await waitJob(s, admin, job.id, terminal);
    // afterwards someone sets an oldPrice just above the new price; reverting the price up would pass it
    const cur = (await listProducts(s, admin)).find((x) => x.id === p!.id)!;
    expect(
      (
        await one(s, admin, {
          id: p!.id,
          field: 'oldPrice',
          value: '2.00',
          baseVersion: cur.versions.oldPrice,
        })
      ).status,
    ).toBe('ok');
    await post(s, admin, `/bulk-jobs/${job.id}/revert`);
    const rev = await waitJob(s, admin, job.id, terminal);
    expect(rev.revertReport[0]).toMatchObject({ reason: 'invalid' });
    expect(await priceOf(p!.id)).toBe('1.00');
  });
});

describe('concurrency: overlapping jobs and live edits lose nothing', () => {
  it('two overlapping percent jobs run at the same time: both apply, history forms an unbroken chain', async () => {
    const cat = 'kitchen';
    const [j1, j2] = await Promise.all([
      startJob(s, admin, {
        filter: { category: [cat], status: ['draft', 'archived'] },
        operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '10' },
      }),
      startJob(s, admin, {
        filter: { category: [cat] },
        operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '100' },
      }),
    ]);
    const [d1, d2] = await Promise.all([
      waitJob(s, admin, j1.id, terminal),
      waitJob(s, admin, j2.id, terminal),
    ]);
    expect(d1.status).toBe('done');
    expect(d2.status).toBe('done');
    const rows = await q(
      `select product_id, old_value, new_value, job_id from product_changes where job_id = any($1) and field='stock' order by product_id, id`,
      [[j1.id, j2.id]],
    );
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);
    let overlapped = 0;
    for (const [, list] of byProduct) {
      if (list.length === 2) {
        overlapped++;
        expect(list[1].old_value).toBe(list[0].new_value); // second saw the first's result: nothing lost
      }
    }
    expect(overlapped).toBeGreaterThan(0);
    // total effect equals the sum of both jobs' deltas
    for (const r of await q(`select id, stock from products where category=$1`, [cat])) {
      const p = initial.find((x) => x.id === r.id)!;
      const delta = (p.status === 'active' ? 0 : 10) + 100;
      const prior = (
        await q(
          `select coalesce(sum((new_value::text)::int - (old_value::text)::int),0)::int d from product_changes where product_id=$1 and field='stock' and (job_id is null or job_id <> all($2))`,
          [r.id, [j1.id, j2.id]],
        )
      )[0].d;
      expect(r.stock).toBe(p.stock + prior + delta);
    }
  });

  it('6 jobs at once over shuffled overlaps: no deadlock, no errors, every job finishes', async () => {
    const jobs = await Promise.all(
      (['books', 'toys', 'garden', 'tools', 'sports', 'beauty'] as const).map((c, i) =>
        startJob(s, i % 2 ? admin : editor1, {
          filter: i % 3 === 0 ? {} : { category: [c, 'books', 'toys'] },
          operation: adjust(String(i + 1), 'stock', 'absolute'),
        }),
      ),
    );
    const done = await Promise.all(jobs.map((j) => waitJob(s, admin, j.id, terminal, 60_000)));
    expect(done.map((d) => d.status)).toEqual(Array(6).fill('done'));
  }, 90_000);

  it('a live batch edit during a running job: both survive; same field: no lost update', async () => {
    const p = (await listProducts(s, admin)).find(
      (x) => x.category === 'office' && x.status === 'active',
    )!;
    const job = await startJob(s, admin, {
      filter: { category: ['office'] },
      operation: adjust('5', 'stock', 'absolute'),
    });
    await new Promise((r) => setTimeout(r, 60));
    const live = await one(s, admin, {
      id: p.id,
      field: 'name',
      value: 'Edited live',
      baseVersion: p.versions.name,
    });
    expect(live.status).toBe('ok');
    await waitJob(s, admin, job.id, terminal);
    const row = (await q('select name, stock from products where id=$1', [p.id]))[0];
    expect(row.name).toBe('Edited live');
    expect(row.stock).toBe(p.stock + 5);
  });

  it('survives its database connections being killed mid-job and still applies everything exactly once', async () => {
    const before = new Map(
      (await q('select id, stock from products')).map((r) => [r.id as string, r.stock as number]),
    );
    const job = await startJob(s, admin, {
      filter: {},
      operation: adjust('13', 'stock', 'absolute'),
    });
    await waitJob(s, admin, job.id, (j) => j.processed >= 200);
    const killer = new Pool({ connectionString: s.databaseUrl, max: 1 });
    for (let i = 0; i < 3; i++) {
      await killer.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`,
      );
      await new Promise((r) => setTimeout(r, 120));
    }
    await killer.end();
    const done = await waitJob(s, admin, job.id, terminal, 60_000);
    expect(done.status).toBe('done');
    expect(done.applied).toBe(2000);
    for (const r of await q('select id, stock from products'))
      expect(r.stock).toBe(before.get(r.id)! + 13);
    expect(
      (await q(`select count(*)::int n from product_changes where job_id=$1`, [job.id]))[0].n,
    ).toBe(2000);
    expect((await call(s.baseUrl, 'GET', '/health')).status).toBe(200);
  }, 90_000);
});

describe('limits', () => {
  it('caps concurrently active jobs per user (429) so one user cannot flood the queue', async () => {
    const capped = await startServer({
      BULK_WORKER_ENABLED: 'false',
      BULK_MAX_ACTIVE_PER_USER: '2',
    });
    try {
      const ses = await loginAs(capped, 'admin');
      const mk = () =>
        createJob(capped, ses, { filter: {}, operation: adjust('1', 'stock', 'absolute') });
      expect((await mk()).status).toBe(201);
      expect((await mk()).status).toBe(201);
      const third = await mk();
      expect(third.status).toBe(429);
      expect(apiErrorSchema.parse(third.body).error.code).toBe('rate_limited');
      // cancelling a queued job (no worker has touched it) frees a slot immediately
      const list = (await call(capped.baseUrl, 'GET', '/bulk-jobs', { cookie: ses.cookie }))
        .body as { jobs: { id: string; status: string }[] };
      expect(list.jobs.every((j) => j.status === 'queued')).toBe(true);
      expect((await post(capped, ses, `/bulk-jobs/${list.jobs[0]!.id}/cancel`)).body).toMatchObject(
        { status: 'cancelled' },
      );
      expect((await mk()).status).toBe(201);
    } finally {
      await capped.stop();
    }
  }, 60_000);

  it('GET /bulk-jobs lists recent jobs without reports', async () => {
    const r = await call(s.baseUrl, 'GET', '/bulk-jobs', { cookie: admin.cookie });
    const jobs = (r.body as { jobs: unknown[] }).jobs.map((j) => bulkJobSchema.parse(j));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.length).toBeLessThanOrEqual(20);
    expect(jobs.every((j) => j.report.length === 0)).toBe(true);
  });
});
