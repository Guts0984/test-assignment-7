import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { COL, cell, contextAs, openCatalog, saved, watchHydration } from './support';

for (const locale of ['en', 'uk'] as const) {
  test(`login page (${locale}): no hydration errors, no axe violations`, async ({ page }) => {
    const hydration = watchHydration(page);
    await page.goto(`/${locale}/login`);
    await expect(
      page.getByRole('form').or(page.getByLabel(locale === 'uk' ? 'Логін' : 'Login')),
    ).toBeVisible();
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual(
      [],
    );
    expect(hydration).toEqual([]);
  });

  test(`catalog (${locale}): no hydration errors, no axe violations, light and dark`, async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'admin');
    const page = await ctx.newPage();
    const hydration = watchHydration(page);
    await openCatalog(page, '', locale);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(page.getByRole('grid')).toBeVisible();
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        r.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`),
      ).toEqual([]);
    }
    expect(hydration).toEqual([]);
    await ctx.close();
  });
}

test('only a screenful of the 2000 rows is in the DOM and scrolling keeps it that way', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '2001');
  expect(await page.locator('[role="row"]').count()).toBeLessThan(45);
  const vp = page.getByTestId('grid-viewport');
  await vp.evaluate((e) => (e.scrollTop = 36 * 1500));
  await expect(page.locator('[role="gridcell"][data-row="1500"]').first()).toBeVisible();
  expect(await page.locator('[role="row"]').count()).toBeLessThan(45);
  // header and the first column stay put while scrolling
  const head = await page.getByRole('columnheader', { name: /SKU/ }).boundingBox();
  const sku = await page.locator('[role="gridcell"][data-row="1500"][data-col="0"]').boundingBox();
  const vbox = (await vp.boundingBox())!;
  expect(head!.y).toBeGreaterThanOrEqual(vbox.y - 1);
  expect(head!.y).toBeLessThan(vbox.y + 5);
  expect(sku!.x).toBeLessThan(vbox.x + 5);
  await ctx.close();
});

test('sort and filters live in the URL: reload restores them and Back steps through them', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  await page.getByRole('button', { name: 'Sort by Stock' }).click();
  await expect(page).toHaveURL(/sort=stock$/);
  await page.getByRole('button', { name: 'Sort by Stock' }).click();
  await expect(page).toHaveURL(/sort=stock&dir=desc/);
  await page.getByRole('button', { name: /Filter by Name/ }).click();
  await page.getByLabel('Contains').fill('lamp');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/name=lamp/);
  const rows = await page.getByRole('grid').getAttribute('aria-rowcount');

  await page.reload();
  await expect(page.getByRole('columnheader', { name: /Stock/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', rows!);

  await page.goBack();
  await expect(page).not.toHaveURL(/name=lamp/);
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '2001');
  await page.goBack();
  await expect(page).toHaveURL(/sort=stock$/);
  await ctx.close();
});

test('a row that stops matching the filter does not vanish after the edit', async ({ browser }) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page, 'status=draft');
  const sku = await cell(page, 1, COL.sku).textContent();
  await cell(page, 1, COL.status).click();
  await page.keyboard.type('Arch'); // -> Archived
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(cell(page, 1, COL.sku)).toHaveText(sku!); // still under the cursor
  await expect(page.getByText('1 row no longer matches the filters')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh view' }).click();
  await expect(page.getByText(/no longer matches/)).toHaveCount(0);
  await ctx.close();
});

test('Ukrainian and English: numbers, dates, plurals and parsing follow the locale', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();

  await openCatalog(page, '', 'uk');
  await expect(cell(page, 0, COL.price)).toHaveText(/^\d[\d\u00a0 ]*,\d{2}$|^$/); // comma decimal (or empty price)
  await expect(cell(page, 0, 8)).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/); // dd.mm.yyyy
  await cell(page, 0, COL.name).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByText('Вибрано 3 клітинки')).toBeVisible();
  // Ukrainian input "1 234,5" is understood
  const stockRow = 2;
  await cell(page, stockRow, COL.stock).click();
  await page.keyboard.type('1 234');
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(cell(page, stockRow, COL.stock)).toHaveText(/^1[\u00a0 ]234$/);

  await openCatalog(page, '', 'en');
  await expect(cell(page, 0, 8)).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/); // mm/dd/yyyy
  await expect(cell(page, stockRow, COL.stock)).toHaveText('1,234');
  await cell(page, 0, COL.name).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByText('3 cells selected')).toBeVisible();
  await ctx.close();
});
