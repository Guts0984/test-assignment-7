import { expect, test } from '@playwright/test';
import { RUN, COL, cell, contextAs, openCatalog, products, saved } from './support';

/** Moves browser focus into the grid with Tab only (no mouse). */
const tabIntoGrid = async (page: import('@playwright/test').Page) => {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    if (role === 'gridcell') return;
  }
  throw new Error('could not Tab into the grid');
};
const active = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? { row: Number(el.dataset.row), col: Number(el.dataset.col) } : null;
  });

test('the table works from the keyboard only: navigate, type, F2, Esc, Tab, Enter, invalid value', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  const before = await products(ctx.request);

  await tabIntoGrid(page);
  expect(await active(page)).toEqual({ row: 0, col: 0 });

  // arrows move; typing starts an edit; Enter commits and moves down
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  expect(await active(page)).toEqual({ row: 2, col: COL.name });
  await page.keyboard.type(`E2E keyboard name ${RUN}`);
  await page.keyboard.press('Enter');
  expect(await active(page)).toEqual({ row: 3, col: COL.name });
  await saved(page);
  await expect(cell(page, 2, COL.name)).toContainText(`E2E keyboard name ${RUN}`);
  expect((await products(ctx.request))[2]!.name).toBe(`E2E keyboard name ${RUN}`);

  // F2 opens, Esc cancels: nothing changes
  const nameRow3 = before[3]!.name;
  await page.keyboard.press('F2');
  await page.keyboard.type('thrown away');
  await page.keyboard.press('Escape');
  await expect(cell(page, 3, COL.name)).toContainText(nameRow3);
  expect((await products(ctx.request))[3]!.name).toBe(nameRow3);

  // Home/End/Ctrl+Home/PageDown
  await page.keyboard.press('End');
  expect((await active(page))!.col).toBe(8);
  await page.keyboard.press('Home');
  expect((await active(page))!.col).toBe(0);
  await page.keyboard.press('Control+Home');
  expect(await active(page)).toEqual({ row: 0, col: 0 });
  await page.keyboard.press('PageDown');
  expect((await active(page))!.row).toBeGreaterThan(5);
  await page.keyboard.press('Control+Home');

  // Tab commits and moves right: stock of row 4
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < COL.stock; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.type('4242');
  await page.keyboard.press('Tab');
  expect(await active(page)).toEqual({ row: 4, col: COL.status });
  await saved(page);
  expect((await products(ctx.request))[4]!.stock).toBe(4242);

  // an invalid value is explained and never leaves the browser
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tooltip')).toContainText('Enter a whole number.');
  await page.keyboard.press('Escape');
  expect((await products(ctx.request))[4]!.stock).toBe(4242);
  await ctx.close();
});
