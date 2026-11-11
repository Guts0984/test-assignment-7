import { expect, test } from '@playwright/test';
import { RUN, COL, cell, contextAs, openCatalog, products, saved } from './support';

test('cell history shows who/when/was/now and an old value can be restored', async ({
  browser,
}) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await openCatalog(page);
  const original = (await products(ctx.request))[12]!.name;

  await cell(page, 12, COL.name).click();
  await page.keyboard.type(`History test value ${RUN}`);
  await page.keyboard.press('Enter');
  await saved(page);

  await cell(page, 12, COL.name).click();
  await page.keyboard.press('Alt+H');
  const dlg = page.getByRole('dialog', { name: 'History: Name' });
  const entry = dlg.getByRole('listitem').first();
  await expect(entry).toContainText('by admin');
  await expect(entry).toContainText(original); // was
  await expect(entry).toContainText(`History test value ${RUN}`); // now
  await expect(entry.locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);

  await entry.getByRole('button', { name: /^Restore/ }).click(); // the newest entry restores the value from before our edit
  await expect(dlg.getByText('Value restored.')).toBeVisible();
  await expect.poll(async () => (await products(ctx.request))[12]!.name).toBe(original);
  await ctx.close();
});
