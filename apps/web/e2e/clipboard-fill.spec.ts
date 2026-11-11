import { expect, test, type Page } from '@playwright/test';
import { COL, cell, contextAs, openCatalog, products, saved } from './support';

/** Largest interaction latency (ms) the browser reported since `start` - the INP-style number. */
const startInteractionProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __maxInteraction: number };
    w.__maxInteraction = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        w.__maxInteraction = Math.max(w.__maxInteraction, e.duration);
    }).observe({
      type: 'event',
      durationThreshold: 16,
      buffered: false,
    } as PerformanceObserverInit);
  });
const maxInteraction = (page: Page) =>
  page.evaluate(() => (window as unknown as { __maxInteraction: number }).__maxInteraction);

test('copy a 10x3 block, paste it elsewhere, Ctrl+Z undoes the whole paste in one step', async ({
  browser,
  browserName,
}) => {
  const ctx = await contextAs(browser, 'admin');
  if (browserName === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await openCatalog(page);
  const before = await products(ctx.request);

  await cell(page, 0, COL.price).click();
  for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+ArrowDown');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+C');

  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown'); // collapses to the active cell, moves down
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.row)).toBe('20');
  await page.keyboard.press('Control+V');
  await saved(page);
  await expect(page.getByText(/\d+ cells? pasted/)).toBeVisible();

  const after = await products(ctx.request);
  let copiedRows = 0;
  for (let i = 0; i < 10; i++) {
    const s = before[i]!;
    const t = after[20 + i]!;
    const equal = t.price === s.price && t.oldPrice === s.oldPrice && t.stock === s.stock;
    const untouched =
      t.price === before[20 + i]!.price &&
      t.oldPrice === before[20 + i]!.oldPrice &&
      t.stock === before[20 + i]!.stock;
    expect(
      equal || untouched,
      `row ${20 + i} is either fully pasted or fully refused (atomic per product)`,
    ).toBe(true);
    if (equal && !untouched) copiedRows++;
  }
  expect(copiedRows).toBeGreaterThan(3);

  // one Ctrl+Z reverts the entire paste
  await page.keyboard.press('Control+Z');
  await saved(page);
  await expect
    .poll(async () => {
      const now = await products(ctx.request);
      return now
        .slice(20, 30)
        .every((p, i) => p.price === before[20 + i]!.price && p.stock === before[20 + i]!.stock);
    })
    .toBe(true);
  await ctx.close();
});

test('fill handle: two numbers continue as a sequence (drag), then 500 rows at once; one Ctrl+Z reverts each', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  const before = await products(ctx.request);
  const handle = () => page.locator('[data-fill-handle]');

  // two seed values 100, 105 in the Stock column
  await cell(page, 0, COL.stock).click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await page.keyboard.type('105');
  await page.keyboard.press('Enter');
  await saved(page);

  // short drag: select both, drag the handle down to row 5
  await cell(page, 0, COL.stock).click();
  await page.keyboard.press('Shift+ArrowDown');
  const h = (await handle().boundingBox())!;
  const target = (await cell(page, 5, COL.stock).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  const afterShort = await products(ctx.request);
  expect(afterShort.slice(0, 6).map((p) => p.stock)).toEqual([100, 105, 110, 115, 120, 125]);

  // 500 rows: drag to the bottom edge so the grid auto-scrolls, then release on row 500
  await startInteractionProbe(page);
  await cell(page, 0, COL.stock).click();
  await page.keyboard.press('Shift+ArrowDown');
  const vp = page.getByTestId('grid-viewport');
  const box = (await vp.boundingBox())!;
  const h2 = (await handle().boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(h2.x + h2.width / 2, box.y + box.height - 8, { steps: 6 });
  const wantScroll = 500 * 36 - (box.height - 40) + 60;
  await expect
    .poll(() => vp.evaluate((e) => e.scrollTop), { timeout: 60_000, intervals: [100] })
    .toBeGreaterThan(wantScroll);
  const scrollTop = await vp.evaluate((e) => e.scrollTop);
  const y = box.y + 40 + 500 * 36 + 18 - scrollTop;
  await page.mouse.move(h2.x + h2.width / 2, Math.min(y, box.y + box.height - 4), { steps: 4 });
  await page.mouse.up();
  await saved(page);

  const after = await products(ctx.request);
  for (const r of [2, 3, 100, 250, 499, 500]) expect(after[r]!.stock, `row ${r}`).toBe(100 + 5 * r);
  expect(await maxInteraction(page)).toBeLessThan(500); // generous: shared CI CPU; the local budget is 200 ms

  // one Ctrl+Z reverts the whole 500-row fill
  await page.keyboard.press('Control+Z');
  await saved(page);
  await expect.poll(async () => (await products(ctx.request))[250]!.stock).toBe(before[250]!.stock);
  expect((await products(ctx.request))[500]!.stock).toBe(before[500]!.stock);
  expect((await products(ctx.request))[1]!.stock).toBe(105); // the two seed cells were separate, earlier actions
  await ctx.close();
});
