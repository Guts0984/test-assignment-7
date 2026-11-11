import { expect, test } from '@playwright/test';
import { RUN, COL, cell, contextAs, openCatalog, products, saved } from './support';

test('two browsers: a conflict on the SAME field asks who wins; different fields both succeed', async ({
  browser,
}) => {
  const a = await contextAs(browser, 'admin');
  const b = await contextAs(browser, 'admin');
  const pa = await a.newPage();
  const pb = await b.newPage();
  await Promise.all([openCatalog(pa), openCatalog(pb)]);

  // --- same field: A saves first, B (stale) conflicts ---
  await cell(pa, 6, COL.name).click();
  await pa.keyboard.type(`Written by A ${RUN}`);
  await pa.keyboard.press('Enter');
  await saved(pa);

  // B edits a harmless cell and the conflicting one in the same breath
  await cell(pb, 7, COL.stock).click();
  await pb.keyboard.type('7007');
  await pb.keyboard.press('Enter');
  await cell(pb, 6, COL.name).click();
  await pb.keyboard.type(`Written by B ${RUN}`);
  await pb.keyboard.press('Enter');
  await saved(pb);

  const afterConflict = await products(a.request);
  expect(afterConflict[7]!.stock).toBe(7007); // B's other edit was saved
  expect(afterConflict[6]!.name).toBe(`Written by A ${RUN}`); // B did not overwrite A
  await cell(pb, 6, COL.name).click();
  const dlg = pb.getByRole('dialog', { name: 'Edit conflict' });
  await expect(dlg).toContainText('admin changed this cell while you were editing.');
  await expect(dlg).toContainText(`Written by A ${RUN}`);
  await expect(dlg).toContainText(`Written by B ${RUN}`);
  await dlg.getByRole('button', { name: 'Keep mine' }).click();
  await saved(pb);
  await expect.poll(async () => (await products(a.request))[6]!.name).toBe(`Written by B ${RUN}`);

  // --- "use theirs" on another cell ---
  await cell(pa, 9, COL.name).click();
  await pa.keyboard.type(`A nine ${RUN}`);
  await pa.keyboard.press('Enter');
  await saved(pa);
  await cell(pb, 9, COL.name).click();
  await pb.keyboard.type(`B nine ${RUN}`);
  await pb.keyboard.press('Enter');
  await saved(pb);
  await cell(pb, 9, COL.name).click();
  await pb
    .getByRole('dialog', { name: 'Edit conflict' })
    .getByRole('button', { name: 'Use theirs' })
    .click();
  await expect(cell(pb, 9, COL.name)).toContainText(`A nine ${RUN}`);

  // --- different fields of one product: no conflict at all ---
  await cell(pa, 11, COL.stock).click();
  await pa.keyboard.type('1111');
  await pa.keyboard.press('Enter');
  await saved(pa);
  await cell(pb, 11, COL.name).click();
  await pb.keyboard.type(`Name from B ${RUN}`);
  await pb.keyboard.press('Enter');
  await saved(pb);
  await expect(pb.getByRole('dialog', { name: 'Edit conflict' })).toHaveCount(0);
  const final = (await products(a.request))[11]!;
  expect(final.stock).toBe(1111);
  expect(final.name).toBe(`Name from B ${RUN}`);
  await a.close();
  await b.close();
});
