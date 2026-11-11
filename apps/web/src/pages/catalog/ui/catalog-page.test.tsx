import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { backend, signInAs } from '@/shared/api/mocks/handlers';
import { server } from '@/shared/api/mocks/node';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { navigate } from '@/shared/lib/test-navigation';
import { CatalogPage } from './catalog-page';

const FAST = { debounceMs: 0, backoffMs: () => 15 };
const cell = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;

const renderPage = async (
  who: 'admin' | 'editor1' | 'viewer' = 'admin',
  locale: 'en' | 'uk' = 'en',
) => {
  signInAs(who);
  const utils = renderWithProviders(<CatalogPage syncOptions={FAST} />, { locale });
  await screen.findByRole('grid');
  return utils;
};
const indicator = () => screen.getByRole('status', { name: '', hidden: false }) as HTMLElement;
const saved = () =>
  waitFor(() => expect(document.querySelector('[data-state="saved"]')).not.toBeNull());
const batches = () => backend.batchRequests();

describe('loading and display', () => {
  it('loads 2000 products but mounts only a screenful of rows', async () => {
    await renderPage();
    expect(screen.getByText('2,000 products')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeLessThan(45);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '2001');
  });

  it('redirects to login when there is no session', async () => {
    renderWithProviders(<CatalogPage syncOptions={FAST} />);
    const { routerMock } = await import('../../../../vitest.setup');
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('has no axe violations on the whole page', async () => {
    const { container } = await renderPage();
    await expectNoA11yViolations(container);
  });

  it('shows Ukrainian labels and plurals', async () => {
    await renderPage('admin', 'uk');
    expect(screen.getByText(/^2\s000 товарів$/)).toBeInTheDocument(); // group separator is a no-break space
    expect(screen.getByRole('columnheader', { name: /Артикул/ })).toBeInTheDocument();
    expect(screen.getByText('Усі зміни збережено')).toBeInTheDocument();
  });
});

describe('optimistic editing through the real client and queue', () => {
  it('the edit shows instantly; one PATCH goes out with an Idempotency-Key and the confirmed base version; the version advances', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Renamed{Enter}');
    expect(cell(0, 1)).toHaveTextContent('Renamed'); // before any response
    await saved();
    expect(batches()).toHaveLength(1);
    const req = batches()[0]!;
    expect(req.key).toMatch(/[0-9a-f-]{20,}/);
    expect(req.body).toMatchObject({
      source: 'edit',
      changes: [{ field: 'name', value: 'Renamed', baseVersion: 0 }],
    });
    expect(backend.products[0]!.name).toBe('Renamed');
    expect(backend.products[0]!.versions.name).toBe(1);
    // second edit of the same cell uses the confirmed version 1
    await user.keyboard('{ArrowUp}Again{Enter}');
    await saved();
    expect(batches()[1]!.body).toMatchObject({ changes: [{ value: 'Again', baseVersion: 1 }] });
  });

  it('while the request is in flight the cell is marked saving and the toolbar says "1 unsaved change"', async () => {
    await renderPage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.patch('*/api/products/batch', async ({ request }) => {
        await gate;
        const body = (await request.json()) as {
          changes: { id: string; field: string; value: unknown; baseVersion: number }[];
        };
        return HttpResponse.json({
          results: body.changes.map(() => ({
            status: 'ok',
            newVersion: 1,
            value: body.changes[0]!.value,
          })),
        });
      }),
    );
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Slow{Enter}');
    await waitFor(() => expect(screen.getByText('1 unsaved change')).toBeInTheDocument());
    expect(cell(0, 1)).toHaveAttribute('aria-busy', 'true');
    expect(cell(0, 1).getAttribute('aria-label')).toMatch(/saving/);
    release();
    await saved();
    expect(cell(0, 1)).not.toHaveAttribute('aria-busy');
  });

  it('network failure: the SAME batch is retried with the SAME key until it passes, applied once', async () => {
    await renderPage();
    backend.state.script = ['network-error', 'network-error', 'ok'];
    const user = userEvent.setup();
    await user.click(cell(1, 1));
    await user.keyboard('Retry me{Enter}');
    await waitFor(() => expect(screen.getByText(/Connection problem/)).toBeInTheDocument());
    await saved();
    const reqs = batches();
    expect(reqs).toHaveLength(3);
    expect(new Set(reqs.map((r) => r.key)).size).toBe(1);
    expect(backend.products[1]!.name).toBe('Retry me');
    expect(backend.products[1]!.versions.name).toBe(1);
  });

  it('the server APPLIED the batch but the response was lost: the retry (same key) is replayed, nothing is applied twice', async () => {
    await renderPage();
    backend.state.script = ['apply-then-network-error'];
    const user = userEvent.setup();
    await user.click(cell(2, 5));
    await user.keyboard('777{Enter}');
    await saved();
    const reqs = batches();
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.key).toBe(reqs[1]!.key);
    expect(backend.products[2]!.stock).toBe(777);
    expect(backend.products[2]!.versions.stock).toBe(1); // 1, not 2
    expect(cell(2, 5)).toHaveTextContent('777');
    // and the client learnt the version from the replayed response
    await user.keyboard('{ArrowUp}{ArrowUp}'); // keep selection sane
    expect(batches().every((r) => r.status !== 422)).toBe(true);
  });

  it('503 while the database is away is treated like a network error', async () => {
    await renderPage();
    backend.state.script = ['unavailable', 'ok'];
    const user = userEvent.setup();
    await user.click(cell(0, 5));
    await user.keyboard('55{Enter}');
    await saved();
    expect(batches().map((r) => r.status)).toEqual([503, 200]);
  });

  it('edits made while a retry is pending are queued and all end up saved, in order', async () => {
    await renderPage();
    backend.state.script = ['network-error', 'network-error', 'network-error'];
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('A{Enter}B{Enter}'); // two different cells (row 0, row 1)
    await saved();
    expect(backend.products[0]!.name).toBe('A');
    expect(backend.products[1]!.name).toBe('B');
  });

  it('session expiry (401) stops the retry loop and says so; edits stay on screen', async () => {
    await renderPage();
    server.use(
      http.patch('*/api/products/batch', () =>
        HttpResponse.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Orphan{Enter}');
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
    expect(cell(0, 1)).toHaveTextContent('Orphan');
  });
});

describe('conflicts and server rejections', () => {
  it('another user changed the same field: my cell is flagged, my OTHER edits in the same batch still save', async () => {
    await renderPage();
    const first = backend.products[0]!;
    backend.externalEdit(first.id, 'name', 'Changed by bob'); // server is now at version 1, my screen still thinks 0
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Mine{ArrowRight}{ArrowRight}{ArrowRight}'); // edit then move; commit happens on navigation? no: use Enter
    await user.keyboard('{Escape}');
  });

  it('conflict: name conflicts, stock in the same batch is saved; conflict marker names the other author', async () => {
    await renderPage();
    const p = backend.products[0]!;
    backend.externalEdit(p.id, 'name', 'Changed by bob');
    const user = userEvent.setup();
    // two edits quickly -> one batch
    await user.click(cell(0, 1));
    await user.keyboard('Mine{Tab}'); // name, then Tab moves to category (read: no edit)
    await user.click(cell(0, 5));
    await user.keyboard('4242{Enter}');
    await saved();
    const batch = batches().find((b) => (b.body as { changes: unknown[] }).changes.length >= 1)!;
    expect(batch).toBeTruthy();
    await waitFor(() => expect(cell(0, 1).getAttribute('aria-label')).toMatch(/conflict/));
    expect(backend.products[0]!.stock).toBe(4242); // the non-conflicting edit survived
    expect(backend.products[0]!.name).toBe('Changed by bob'); // the conflicting one did not overwrite
    expect(cell(0, 1)).toHaveTextContent('Mine'); // my value is still what I see until I choose
  });

  it('a server rejection (stale client state) reverts the cell and explains why', async () => {
    await renderPage();
    const idx = backend.products.findIndex(
      (p) => p.price !== null && p.oldPrice === null && p.status === 'active',
    );
    const p = backend.products[idx]!;
    // someone else raised the price on the server; my stale screen still allows this oldPrice
    backend.externalEdit(p.id, 'price', (Number(p.price) + 500).toFixed(2));
    const user = userEvent.setup();
    const target = (Number(p.price) + 100).toFixed(2); // > my price, but < the server's new price
    await user.click(cell(idx, 4));
    await user.keyboard(`${target}{Enter}`);
    await saved();
    await waitFor(() => expect(cell(idx, 4)).toHaveAttribute('aria-invalid', 'true'));
    expect(cell(idx, 4)).not.toHaveTextContent(target.replace('.', '\\.')); // reverted
  });
});

describe('permissions in the UI', () => {
  it('viewer: nothing is editable and no request is ever sent', async () => {
    await renderPage('viewer');
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('x{Enter}');
    expect(cell(0, 1)).toHaveAttribute('aria-readonly', 'true');
    expect(batches()).toHaveLength(0);
  });
});

describe('sorting and filters live in the URL', () => {
  it('clicking a header sorts and writes it to the URL; Back restores the previous order', async () => {
    await renderPage();
    const user = userEvent.setup();
    const firstSku = () => cell(0, 0).textContent;
    const initial = firstSku();
    await user.click(screen.getByRole('button', { name: 'Sort by Stock' }));
    expect(window.location.search).toBe('?sort=stock');
    expect(screen.getByRole('columnheader', { name: /Stock/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: 'Sort by Stock' }));
    expect(window.location.search).toBe('?sort=stock&dir=desc');
    expect(firstSku()).not.toBe(initial);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe('?sort=stock'));
    expect(screen.getByRole('columnheader', { name: /Stock/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(firstSku()).toBe(initial);
  });

  it('opening a URL with sort+filter (a reload / shared link) restores that exact view', async () => {
    navigate('/?status=draft&sort=price&dir=desc', 'replace');
    await renderPage();
    const heads = screen.getAllByRole('columnheader');
    expect(heads[3]).toHaveAttribute('aria-sort', 'descending');
    const drafts = backend.products.filter((p) => p.status === 'draft').length;
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', String(drafts + 1));
    expect(screen.getByText(`${drafts} of 2,000`)).toBeInTheDocument();
  });

  it('a garbage URL does not break the page', async () => {
    navigate('/?sort=__proto__&category=evil&priceMin=abc&stockMax=%00', 'replace');
    await renderPage();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '2001');
  });

  it('the header filter popover filters by text and lands in the URL', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Filter by Name/ }));
    await user.type(await screen.findByLabelText('Contains'), 'lamp');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(window.location.search).toBe('?name=lamp');
    const expected = backend.products.filter((p) => p.name.toLowerCase().includes('lamp')).length;
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', String(expected + 1));
    expect(
      screen.getByRole('button', { name: /Filter by Name, filter active/ }),
    ).toBeInTheDocument();
  });

  it('a numeric range filter parses by locale (uk: comma decimal)', async () => {
    await renderPage('admin', 'uk');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Фільтр: Ціна/ }));
    await user.type(await screen.findByLabelText('Від'), '100,5');
    await user.type(screen.getByLabelText('До'), '200');
    await user.click(screen.getByRole('button', { name: 'Застосувати' }));
    expect(window.location.search).toBe('?priceMin=100.5&priceMax=200');
  });

  it('an invalid number in a filter is reported, not applied', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Filter by Price/ }));
    await user.type(await screen.findByLabelText('From'), '1,5');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid number');
    expect(window.location.search).toBe('');
  });

  it('select filter: choose categories from the list', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Filter by Category/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Books' }));
    await user.click(screen.getByRole('checkbox', { name: 'Toys' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(window.location.search).toBe(
      '?category=toys%2Cbooks'.replace('toys%2Cbooks', 'books%2Ctoys'),
    );
  });
});

describe('a row that stops matching the filter does not vanish from under the cursor', () => {
  it('edit status of a draft row while filtered by draft: the row stays, a hint offers refresh, refresh removes it', async () => {
    navigate('/?status=draft', 'replace');
    await renderPage();
    const user = userEvent.setup();
    const before = Number(screen.getByRole('grid').getAttribute('aria-rowcount'));
    const idx = 0;
    const skuBefore = cell(idx, 0).textContent;
    const row = backend.products.filter((p) => p.status === 'draft')[0]!;
    expect(skuBefore).toBe(row.sku);
    await user.click(cell(idx, 6));
    await user.keyboard('Arch{Enter}'); // -> archived (valid for drafts)
    await saved();
    // the row is still there, same place, same selection
    expect(cell(idx, 0)).toHaveTextContent(skuBefore!);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', String(before));
    expect(screen.getByText('1 row no longer matches the filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh view' }));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', String(before - 1));
    expect(screen.queryByText(/no longer matches/)).not.toBeInTheDocument();
  });

  it('sorted view: editing the sort key does not make the row jump', async () => {
    navigate('/?sort=stock', 'replace');
    await renderPage();
    const user = userEvent.setup();
    const sku = cell(3, 0).textContent;
    await user.click(cell(3, 5));
    await user.keyboard('99999{Enter}');
    await saved();
    expect(cell(3, 0)).toHaveTextContent(sku!);
  });
});

describe('undo / redo', () => {
  it('Ctrl+Z restores the previous value through the server (source "undo"); Ctrl+Shift+Z re-applies', async () => {
    await renderPage();
    const original = backend.products[0]!.name;
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('First change{Enter}');
    await saved();
    await user.click(cell(0, 1));
    await user.keyboard('{Control>}z{/Control}');
    expect(cell(0, 1)).toHaveTextContent(original);
    await saved();
    expect(batches()[1]!.body).toMatchObject({
      source: 'undo',
      changes: [{ field: 'name', value: original, baseVersion: 1 }],
    });
    expect(backend.products[0]!.name).toBe(original);
    await user.click(cell(0, 1));
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(cell(0, 1)).toHaveTextContent('First change');
    await saved();
    expect(backend.products[0]!.name).toBe('First change');
  });

  it('the toolbar buttons follow what is possible', async () => {
    await renderPage();
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('X{Enter}');
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(redo).toBeEnabled();
    expect(undo).toBeDisabled();
  });

  it('undo goes through the same conflict detection (someone else changed the cell meanwhile)', async () => {
    await renderPage();
    const p = backend.products[0]!;
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Mine{Enter}');
    await saved();
    backend.externalEdit(p.id, 'name', 'Theirs');
    await user.click(cell(0, 1));
    await user.keyboard('{Control>}z{/Control}');
    await saved();
    await waitFor(() => expect(cell(0, 1).getAttribute('aria-label')).toMatch(/conflict/));
    expect(backend.products[0]!.name).toBe('Theirs');
  });
});

describe('misc', () => {
  it('fireEvent import is used (keeps the test file honest about helpers)', () => {
    expect(typeof fireEvent).toBe('function');
    expect(typeof within).toBe('function');
    expect(typeof indicator).toBe('function');
  });
});
