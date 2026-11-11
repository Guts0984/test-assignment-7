import { expect, test } from '@playwright/test';
import { COL, cell, contextAs, openCatalog, products, saved } from './support';

// editor1 owns electronics, computers, phones, home-appliances, furniture; "books" belongs to editor2.
const FOREIGN = 'books';
const OWN = 'electronics';

test('editor: own category is editable, a foreign one is read-only everywhere (typing, direct API, restore, bulk)', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'editor1');
  const admin = await contextAs(browser, 'admin');
  const page = await ctx.newPage();

  // own category: editable
  await openCatalog(page, `category=${OWN}`);
  await expect(cell(page, 0, COL.name)).not.toHaveAttribute('aria-readonly', 'true');
  await cell(page, 0, COL.stock).click();
  await page.keyboard.type('321');
  await page.keyboard.press('Enter');
  await saved(page);

  // foreign category: looks and behaves read-only
  await openCatalog(page, `category=${FOREIGN}`);
  const first = cell(page, 0, COL.name);
  await expect(first).toHaveAttribute('aria-readonly', 'true');
  await first.click();
  await page.keyboard.type('hack');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toContainText('You cannot edit this product.');

  const all = await products(admin.request);
  const foreign = all.find((p) => p.category === FOREIGN)!;

  // a direct request is refused by the SERVER
  const direct = await ctx.request.patch('/api/products/batch', {
    data: {
      changes: [
        { id: foreign.id, field: 'stock', value: 9999, baseVersion: foreign.versions.stock ?? 0 },
      ],
    },
  });
  expect((await direct.json()).results[0].status).toBe('forbidden');
  // ...also when trying to move an own product into a foreign category
  const own = all.find((p) => p.category === OWN)!;
  const move = await ctx.request.patch('/api/products/batch', {
    data: {
      changes: [
        { id: own.id, field: 'category', value: FOREIGN, baseVersion: own.versions.category ?? 0 },
      ],
    },
  });
  expect((await move.json()).results[0].status).toBe('forbidden');

  // restore from history of a foreign product
  await admin.request.patch('/api/products/batch', {
    data: {
      changes: [
        {
          id: foreign.id,
          field: 'stock',
          value: foreign.stock + 1,
          baseVersion: foreign.versions.stock ?? 0,
        },
      ],
    },
  });
  const hist = await (
    await ctx.request.get(`/api/products/${foreign.id}/history?field=stock`)
  ).json();
  const restore = await ctx.request.post(`/api/history/${hist.entries[0].id}/restore`, {
    data: { baseVersion: 1 },
  });
  expect(restore.status()).toBe(403);

  // bulk job over a foreign category: everything is skipped with a reason, nothing changes
  const job = await (
    await ctx.request.post('/api/bulk-jobs', {
      data: {
        filter: { category: [FOREIGN] },
        operation: { type: 'adjust', field: 'stock', mode: 'absolute', amount: '5' },
      },
    })
  ).json();
  await expect
    .poll(async () => (await (await ctx.request.get(`/api/bulk-jobs/${job.id}`)).json()).status)
    .toBe('done');
  const done = await (await ctx.request.get(`/api/bulk-jobs/${job.id}`)).json();
  expect(done.applied).toBe(0);
  expect(done.skipped).toBe(done.total);
  expect(done.report[0].reason).toBe('forbidden');

  const now = await products(admin.request);
  expect(now.find((p) => p.id === foreign.id)!.stock).toBe(foreign.stock + 1); // only admin's own change
  expect(now.find((p) => p.id === own.id)!.category).toBe(OWN);
  await ctx.close();
  await admin.close();
});

test('viewer can read everything and change nothing', async ({ browser }) => {
  const ctx = await contextAs(browser, 'viewer');
  const page = await ctx.newPage();
  await openCatalog(page);
  await expect(cell(page, 0, COL.name)).toHaveAttribute('aria-readonly', 'true');
  await expect(page.getByRole('button', { name: 'Bulk change…' })).toHaveCount(0);
  await cell(page, 0, COL.name).click();
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox')).toHaveCount(0);

  const p = (await products(ctx.request))[0]!;
  const patch = await ctx.request.patch('/api/products/batch', {
    data: { changes: [{ id: p.id, field: 'stock', value: 1, baseVersion: 0 }] },
  });
  expect(patch.status()).toBe(403);
  expect(
    (
      await ctx.request.post('/api/bulk-jobs', {
        data: { filter: {}, operation: { type: 'addTag', tag: 'x' } },
      })
    ).status(),
  ).toBe(403);
  expect((await ctx.request.get(`/api/products/${p.id}/history`)).status()).toBe(200); // reading is allowed
  await ctx.close();
});

test('no session: the API refuses and the app sends you to the login page', async ({ browser }) => {
  const ctx = await browser.newContext();
  expect((await ctx.request.get('/api/products')).status()).toBe(401);
  const page = await ctx.newPage();
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login/);
  await ctx.close();
});
