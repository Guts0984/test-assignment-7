import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { computeAdjust, matchesFilter } from '@catalog/shared';
import { backend, signInAs } from '@/shared/api/mocks/handlers';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { navigate } from '@/shared/lib/test-navigation';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { CatalogPage } from './catalog-page';

const FAST = { debounceMs: 0, backoffMs: () => 15 };
const cell = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;

const renderPage = async (
  who: 'admin' | 'editor1' | 'viewer' = 'admin',
  locale: 'en' | 'uk' = 'en',
) => {
  signInAs(who);
  const u = renderWithProviders(<CatalogPage syncOptions={FAST} />, { locale });
  await screen.findByRole('grid');
  return u;
};

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Bulk change…' }));
  return screen.findByRole('dialog', { name: 'Bulk change' });
};

const startPercent = async (
  user: ReturnType<typeof userEvent.setup>,
  dlg: HTMLElement,
  amount: string,
) => {
  await user.type(within(dlg).getByLabelText('Amount'), amount);
  await user.click(within(dlg).getByRole('button', { name: 'Start' }));
};

const EDITOR1_CATS = ['electronics', 'computers', 'phones', 'home-appliances', 'furniture'];
const EDITOR_OWN = () =>
  backend.products.filter((p) => p.category && EDITOR1_CATS.includes(p.category)).length;

const status = (dlg: HTMLElement) => within(dlg).getByTestId('job-status');

describe('bulk change dialog', () => {
  it('viewers cannot see the button', async () => {
    await renderPage('viewer');
    expect(screen.queryByRole('button', { name: 'Bulk change…' })).not.toBeInTheDocument();
  });

  it('previews how many products the CURRENT filter affects (and how many the user may change)', async () => {
    navigate('/?category=books&status=active', 'replace');
    await renderPage();
    const dlg = await openDialog(userEvent.setup());
    const n = backend.products.filter((p) =>
      matchesFilter(p, { category: ['books'], status: ['active'] }),
    ).length;
    expect(
      await within(dlg).findByText(new RegExp(`${n} products match; you can change ${n} of them`)),
    ).toBeInTheDocument();
  });

  it('an editor sees how many of the matches are theirs', async () => {
    await renderPage('editor1');
    const dlg = await openDialog(userEvent.setup());
    expect(
      await within(dlg).findByText(/2000 products match|2,000 products match/),
    ).toBeInTheDocument();
    expect(
      within(dlg).getByText(new RegExp(`you can change ${EDITOR_OWN()} of them`)),
    ).toBeInTheDocument();
  });

  it('the spec example: price +10% for a category with status active - runs with progress, ends done, table updates WITHOUT a reload', async () => {
    navigate('/?category=books&status=active', 'replace');
    await renderPage();
    const user = userEvent.setup();
    const inView = backend.products.filter((p) =>
      matchesFilter(p, { category: ['books'], status: ['active'] }),
    );
    // a product the job will really change (+10% that would reach its old price is skipped, correctly)
    const first = inView.find(
      (p) =>
        p.price !== null && (p.oldPrice === null || Number(p.oldPrice) > Number(p.price) * 1.11),
    )!;
    const before = first.price!;
    const dlg = await openDialog(user);
    await startPercent(user, dlg, '10');
    expect(await within(dlg).findByRole('progressbar')).toBeInTheDocument();
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Done'));
    expect(within(dlg).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    const expected = (computeAdjust('price', before, 'percent', '10') as { value: string }).value;
    expect(backend.products.find((p) => p.id === first.id)!.price).toBe(expected);
    // the grid shows the new price although nobody reloaded the page
    // a visible row that the job really changed must now show the new price, with no reload in between
    const idx = inView.findIndex(
      (p) => backend.products.find((x) => x.id === p.id)!.price !== p.price,
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(14); // inside the rendered window
    const now = backend.products.find((x) => x.id === inView[idx]!.id)!.price!;
    expect(now).not.toBe(inView[idx]!.price);
    const shown = Number(now).toLocaleString('en', { minimumFractionDigits: 2 });
    await waitFor(() => expect(cell(idx, 3)).toHaveTextContent(shown));
  });

  it('shows progress in parts while a big job runs, and lets you cancel; what was applied stays', async () => {
    await renderPage();
    const user = userEvent.setup();
    const dlg = await openDialog(user);
    await user.selectOptions(
      within(dlg).getByLabelText('Operation'),
      'Change a number by an amount',
    );
    await user.selectOptions(within(dlg).getByLabelText('Field'), 'Stock');
    await startPercent(user, dlg, '1');
    await waitFor(() =>
      expect(within(dlg).getByText(/^\d+ of 2000 products processed/)).toBeInTheDocument(),
    );
    await user.click(await within(dlg).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Cancelled'), { timeout: 8000 });
    const changed = backend.products.filter((p) => p.versions.stock === 1).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(2000);
    expect(within(dlg).getByRole('button', { name: 'Revert' })).toBeInTheDocument();
  });

  it('an editor over everything: foreign-category products are skipped, listed with the reason, never changed', async () => {
    await renderPage('editor1');
    const user = userEvent.setup();
    const dlg = await openDialog(user);
    await user.selectOptions(
      within(dlg).getByLabelText('Operation'),
      'Change a number by an amount',
    );
    await user.selectOptions(within(dlg).getByLabelText('Field'), 'Stock');
    await startPercent(user, dlg, '2');
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Done'), { timeout: 12000 });
    expect(
      within(dlg).getByText(new RegExp(`^.*${EDITOR_OWN()} products changed`)),
    ).toBeInTheDocument();
    expect(within(dlg).getByText(/products skipped/)).toBeInTheDocument();
    const report = within(dlg).getByRole('region', { name: 'Skipped products' });
    expect(within(report).getAllByText('No permission').length).toBeGreaterThan(0);
    expect(within(report).getAllByRole('row')[1]).toHaveTextContent(/^SKU-/);
    expect(within(dlg).getByText(/Showing the first 200 of/)).toBeInTheDocument();
    expect(
      backend.products
        .filter((p) => p.versions.stock === 1)
        .every((p) =>
          ['electronics', 'computers', 'phones', 'home-appliances', 'furniture'].includes(
            p.category ?? '',
          ),
        ),
    ).toBe(true);
  });

  it('revert puts values back; a cell someone else changed after the job is left alone and reported', async () => {
    navigate('/?category=shoes&status=active', 'replace');
    await renderPage();
    const user = userEvent.setup();
    const targets = backend.products.filter((p) =>
      matchesFilter(p, { category: ['shoes'], status: ['active'] }),
    );
    const originals = new Map(targets.map((p) => [p.id, p.price]));
    const dlg = await openDialog(user);
    await startPercent(user, dlg, '20');
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Done'));
    // pick a product the job really changed, then a colleague edits that cell afterwards
    const changed = backend.products.find(
      (p) => originals.has(p.id) && p.price !== originals.get(p.id),
    )!;
    backend.externalEdit(changed.id, 'price', '1.23');
    await user.click(within(dlg).getByRole('button', { name: 'Revert' }));
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Reverted'));
    for (const t of targets.filter((x) => x.id !== changed.id))
      expect(backend.products.find((p) => p.id === t.id)!.price).toBe(originals.get(t.id));
    expect(backend.products.find((p) => p.id === changed.id)!.price).toBe('1.23');
    const rep = within(dlg).getByRole('region', { name: 'Not reverted' });
    expect(within(rep).getByText('Changed after the job')).toBeInTheDocument();
    expect(
      within(dlg).getByText(/1 cell was left alone because it changed after the job/),
    ).toBeInTheDocument();
  });

  it('bad input is explained and nothing is sent', async () => {
    await renderPage();
    const user = userEvent.setup();
    const dlg = await openDialog(user);
    await user.type(within(dlg).getByLabelText('Amount'), '10,5'); // comma is not the decimal mark in English
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Enter a valid number.');
    await user.click(within(dlg).getByRole('button', { name: 'Start' }));
    expect(backend.state.requests.filter((r) => r.path === '/bulk-jobs')).toHaveLength(0);
    await user.clear(within(dlg).getByLabelText('Amount'));
    await user.type(within(dlg).getByLabelText('Amount'), '-100');
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('100% or more');
  });

  it('Ukrainian: the amount is read with a comma and the labels are Ukrainian', async () => {
    navigate('/?category=toys&status=active', 'replace');
    await renderPage('admin', 'uk');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Масова зміна…' }));
    const dlg = await screen.findByRole('dialog', { name: 'Масова зміна' });
    await user.type(within(dlg).getByLabelText('Величина'), '10,5');
    await user.click(within(dlg).getByRole('button', { name: 'Запустити' }));
    await waitFor(() => expect(within(dlg).getByTestId('job-status')).toHaveTextContent('Готово'));
    const req = backend.state.requests.find((r) => r.path === '/bulk-jobs')!.body as {
      operation: { amount: string };
    };
    expect(req.operation.amount).toBe('10.5');
  });

  it('has no axe violations (form and finished job)', async () => {
    navigate('/?category=garden&status=archived', 'replace');
    await renderPage();
    const user = userEvent.setup();
    const dlg = await openDialog(user);
    await expectNoA11yViolations(document.body);
    await startPercent(user, dlg, '5');
    await waitFor(() => expect(status(dlg)).toHaveTextContent('Done'));
    await expectNoA11yViolations(document.body);
  });
});
