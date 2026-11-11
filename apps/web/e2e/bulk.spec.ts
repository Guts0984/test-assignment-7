import { expect, test } from '@playwright/test';
import { contextAs, openCatalog, products } from './support';

// These tests need a slow-enough job to cancel mid-way: start the stack with BULK_CHUNK_DELAY_MS=150 (CI does).

test('bulk change: runs in the background with progress, cancel keeps the applied part, revert undoes it (later edits are left alone)', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  const before = await products(ctx.request);

  await page.getByRole('button', { name: 'Bulk change…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Bulk change' });
  await expect(dlg.getByText(/2,000 products match; you can change 2,000 of them/)).toBeVisible();
  await dlg.getByLabel('Operation').selectOption({ label: 'Change a number by an amount' });
  await dlg.getByLabel('Field').selectOption({ label: 'Stock' });
  await dlg.getByLabel('Amount', { exact: true }).fill('1');
  await dlg.getByRole('button', { name: 'Start' }).click();

  // progress is reported in parts; cancel once some of it is done
  await expect(dlg.getByRole('progressbar')).toBeVisible();
  await expect(dlg.getByText(/^[1-9]\d* of 2000 products processed/)).toBeVisible({
    timeout: 30_000,
  });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg.getByTestId('job-status')).toHaveText('Cancelled');

  const applied = Number(
    (await dlg.getByText(/products? changed/).textContent())!
      .match(/(\d[\d,]*) products? changed/)![1]!
      .replace(',', ''),
  );
  expect(applied).toBeGreaterThan(0);
  expect(applied).toBeLessThan(2000);
  const mid = await products(ctx.request);
  expect(mid.filter((p, i) => p.stock !== before[i]!.stock).length).toBe(applied); // what was applied stays, nothing half-applied

  // someone else changes one of the touched cells afterwards
  const touched = mid.findIndex((p, i) => p.stock !== before[i]!.stock);
  const tp = mid[touched]!;
  const edit = await ctx.request.patch('/api/products/batch', {
    data: {
      changes: [{ id: tp.id, field: 'stock', value: 555555, baseVersion: tp.versions.stock }],
    },
  });
  expect(edit.ok()).toBeTruthy();

  await dlg.getByRole('button', { name: 'Revert' }).click();
  await expect(dlg.getByTestId('job-status')).toHaveText('Reverted', { timeout: 60_000 });
  await expect(
    dlg
      .getByRole('region', { name: 'Not reverted' })
      .getByText('Changed after the job', { exact: true }),
  ).toBeVisible();

  const end = await products(ctx.request);
  for (let i = 0; i < end.length; i++) {
    if (i === touched)
      expect(end[i]!.stock).toBe(555555); // the later edit survived the revert
    else expect(end[i]!.stock, `row ${i}`).toBe(before[i]!.stock); // everything else is back
  }
  await ctx.close();
});

test('bulk change by the current filter: price +10% for a category with status active; the table updates without a reload', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page, 'category=garden&status=active');
  const before = await products(ctx.request);
  const targets = before.filter((p) => p.category === 'garden' && p.status === 'active');

  await page.getByRole('button', { name: 'Bulk change…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Bulk change' });
  await expect(dlg.getByText(new RegExp(`${targets.length} products match`))).toBeVisible();
  await dlg.getByLabel('Amount', { exact: true }).fill('10');
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(dlg.getByTestId('job-status')).toHaveText('Done', { timeout: 60_000 });

  const after = await products(ctx.request);
  const changed = targets.filter((t) => after.find((p) => p.id === t.id)!.price !== t.price);
  expect(changed.length).toBeGreaterThan(0);
  const exact = (p: string) => (Math.round(Number(p) * 110) / 100).toFixed(2);
  const one = changed.find((t) => t.oldPrice === null) ?? changed[0]!;
  if (one.oldPrice === null)
    expect(after.find((p) => p.id === one.id)!.price).toBe(exact(one.price!));

  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  const idx = targets.findIndex((t) => t.id === changed[0]!.id);
  if (idx < 14) {
    const now = after.find((p) => p.id === changed[0]!.id)!.price!;
    await expect(page.locator(`[role="gridcell"][data-row="${idx}"][data-col="3"]`)).toContainText(
      Number(now).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
  }
  await ctx.close();
});
