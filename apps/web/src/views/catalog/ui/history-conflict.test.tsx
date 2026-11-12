import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { backend, signInAs } from '@/shared/api/mocks/handlers';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { CatalogPage } from './catalog-page';

const FAST = { debounceMs: 0, backoffMs: () => 15 };
const cell = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;
const saved = () =>
  waitFor(() => expect(document.querySelector('[data-state="saved"]')).not.toBeNull());

const renderPage = async (who: 'admin' | 'viewer' = 'admin') => {
  signInAs(who);
  const utils = renderWithProviders(<CatalogPage syncOptions={FAST} />);
  await screen.findByRole('grid');
  return utils;
};

const editName = async (user: ReturnType<typeof userEvent.setup>, row: number, text: string) => {
  await user.click(cell(row, 1));
  await user.keyboard(`${text}{Enter}`);
  await saved();
};

describe('cell history popover', () => {
  it('Alt+H shows who changed the cell, when, and was -> now, newest first', async () => {
    await renderPage();
    const user = userEvent.setup();
    const original = backend.products[0]!.name;
    await editName(user, 0, 'First');
    await editName(user, 0, 'Second');
    await user.click(cell(0, 1));
    await user.keyboard('{Alt>}h{/Alt}');
    const pop = await screen.findByRole('dialog', { name: 'History: Name' });
    const items = await within(pop).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('by admin');
    expect(items[0]).toHaveTextContent('Second');
    expect(items[0]).toHaveTextContent('First'); // was
    expect(items[1]).toHaveTextContent(original);
    expect(within(items[0]!).getByText(/edit/)).toBeInTheDocument();
    expect(items[0]!.querySelector('time')).toHaveAttribute('datetime');
  });

  it('the toolbar button opens it too', async () => {
    await renderPage();
    const user = userEvent.setup();
    await editName(user, 1, 'Zed');
    await user.click(cell(1, 1));
    await user.click(screen.getByRole('button', { name: 'Cell history' }));
    expect(await screen.findByRole('dialog', { name: 'History: Name' })).toBeInTheDocument();
  });

  it('empty history says so', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(cell(3, 1));
    await user.keyboard('{Alt>}h{/Alt}');
    expect(await screen.findByText('No changes yet.')).toBeInTheDocument();
  });

  it('restoring an old value goes through the server and updates the table', async () => {
    await renderPage();
    const user = userEvent.setup();
    const original = backend.products[0]!.name;
    await editName(user, 0, 'Changed');
    await user.click(cell(0, 1));
    await user.keyboard('{Alt>}h{/Alt}');
    const pop = await screen.findByRole('dialog', { name: 'History: Name' });
    await user.click(await within(pop).findByRole('button', { name: `Restore "${original}"` }));
    expect(await within(pop).findByText('Value restored.')).toBeInTheDocument();
    expect(backend.products[0]!.name).toBe(original);
    expect(backend.products[0]!.versions.name).toBe(2);
    expect(cell(0, 1)).toHaveTextContent(original);
  });

  it('restore is a normal change: if someone changed the cell meanwhile it conflicts and names them', async () => {
    await renderPage();
    const user = userEvent.setup();
    await editName(user, 0, 'Mine');
    await user.click(cell(0, 1));
    await user.keyboard('{Alt>}h{/Alt}');
    const pop = await screen.findByRole('dialog', { name: 'History: Name' });
    const btn = await within(pop).findByRole('button', { name: /^Restore/ });
    backend.externalEdit(backend.products[0]!.id, 'name', 'Theirs');
    await user.click(btn);
    expect(await within(pop).findByText(/bob changed this cell since/)).toBeInTheDocument();
    expect(backend.products[0]!.name).toBe('Theirs');
  });

  it('a viewer can read the history but has no restore buttons', async () => {
    signInAs('viewer');
    backend.externalEdit(backend.products[0]!.id, 'name', 'By bob');
    renderWithProviders(<CatalogPage syncOptions={FAST} />);
    await screen.findByRole('grid');
    await userEvent.setup().click(cell(0, 1));
    await userEvent.setup().keyboard('{Alt>}h{/Alt}');
    const pop = await screen.findByRole('dialog', { name: 'History: Name' });
    expect(await within(pop).findByText(/by bob/)).toBeInTheDocument();
    expect(within(pop).queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument();
  });

  it('has no axe violations while open', async () => {
    const { baseElement } = await renderPage();
    const user = userEvent.setup();
    await editName(user, 0, 'A11y');
    await user.click(cell(0, 1));
    await user.keyboard('{Alt>}h{/Alt}');
    await screen.findByRole('dialog', { name: 'History: Name' });
    await expectNoA11yViolations(baseElement);
  });
});

describe('undo and a refused edit', () => {
  it('an edit the server refused is NOT on the undo stack: Ctrl+Z sends nothing and does not spend a step', async () => {
    await renderPage();
    const user = userEvent.setup();
    const idx = backend.products.findIndex(
      (p) => p.price !== null && p.oldPrice === null && p.status !== 'archived',
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(14); // rendered
    const p = backend.products[idx]!;
    // an edit that earlier succeeds (the undo stack has something real in it)
    await user.click(cell(idx, 5));
    await user.keyboard(`${p.stock + 1}{Enter}`);
    await saved();
    // someone raises the price on the server, so a perfectly valid-looking oldPrice is now refused there
    backend.externalEdit(p.id, 'price', '900000.00');
    await user.click(cell(idx, 4));
    await user.keyboard('1000.00{Enter}');
    await saved();
    await waitFor(() => expect(cell(idx, 4).getAttribute('aria-invalid')).toBe('true'));
    const sent = backend.batchRequests().length;
    await user.keyboard('{Control>}z{/Control}');
    await saved();
    // the first Ctrl+Z undid the STOCK edit (the real one), not the refused oldPrice
    expect(backend.batchRequests().length).toBe(sent + 1);
    const last = backend.batchRequests().at(-1)!.body as { changes: { field: string }[] };
    expect(last.changes.map((c) => c.field)).toEqual(['stock']);
  });
});

describe('conflict resolution popover', () => {
  const makeConflict = async (user: ReturnType<typeof userEvent.setup>) => {
    const p = backend.products[0]!;
    backend.externalEdit(p.id, 'name', 'Changed by bob');
    await user.click(cell(0, 1));
    await user.keyboard('Mine{Enter}');
    await saved();
    await waitFor(() => expect(cell(0, 1).getAttribute('aria-label')).toMatch(/conflict/));
    await user.click(cell(0, 1));
  };

  it('shows both values and the other author; "keep mine" re-sends with the server version and wins', async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    const pop = await screen.findByRole('dialog', { name: 'Edit conflict' });
    expect(pop).toHaveTextContent('bob changed this cell while you were editing.');
    expect(within(pop).getByText('Mine')).toBeInTheDocument();
    expect(within(pop).getByText('Changed by bob')).toBeInTheDocument();
    await user.click(within(pop).getByRole('button', { name: 'Keep mine' }));
    await saved();
    await waitFor(() => expect(backend.products[0]!.name).toBe('Mine'));
    const last = backend.batchRequests().at(-1)!.body as { changes: { baseVersion: number }[] };
    expect(last.changes[0]!.baseVersion).toBe(1); // the server's version, not the stale 0
    expect(screen.queryByRole('dialog', { name: 'Edit conflict' })).not.toBeInTheDocument();
    expect(cell(0, 1).getAttribute('aria-label')).not.toMatch(/conflict/);
  });

  it("Delete and Ctrl+Z on a cell in conflict do NOT silently overwrite the other person's value", async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    await user.keyboard('{Escape}');
    const before = backend.batchRequests().length;
    await user.keyboard('{Delete}');
    await user.keyboard('{Control>}z{/Control}');
    await saved();
    expect(backend.batchRequests().length).toBe(before); // nothing was sent
    expect(backend.products[0]!.name).toBe('Changed by bob'); // the server still has bob's value
    expect(cell(0, 1).getAttribute('aria-label')).toMatch(/conflict/); // still unresolved
  });

  it('after choosing, focus goes back to the cell (not to <body>), so the keyboard keeps working', async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    const pop = await screen.findByRole('dialog', { name: 'Edit conflict' });
    await user.click(within(pop).getByRole('button', { name: 'Use theirs' }));
    await waitFor(() => expect(document.activeElement).toBe(cell(0, 1)));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(1, 1));
  });

  it('"use theirs" shows the server value and sends nothing more', async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    const before = backend.batchRequests().length;
    const pop = await screen.findByRole('dialog', { name: 'Edit conflict' });
    await user.click(within(pop).getByRole('button', { name: 'Use theirs' }));
    await waitFor(() => expect(cell(0, 1)).toHaveTextContent('Changed by bob'));
    expect(backend.batchRequests().length).toBe(before);
    expect(backend.products[0]!.name).toBe('Changed by bob');
  });

  it('Esc closes it without resolving (the marker stays)', async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    await screen.findByRole('dialog', { name: 'Edit conflict' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit conflict' })).not.toBeInTheDocument(),
    );
  });

  it('keyboard: after Esc, Enter on the conflicted cell brings it back with focus inside the dialog', async () => {
    await renderPage();
    const user = userEvent.setup();
    await makeConflict(user);
    await screen.findByRole('dialog', { name: 'Edit conflict' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit conflict' })).not.toBeInTheDocument(),
    );
    cell(0, 1).focus();
    await user.keyboard('{Enter}');
    const pop = await screen.findByRole('dialog', { name: 'Edit conflict' });
    await waitFor(() => expect(pop.contains(document.activeElement)).toBe(true));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); // it did not open the cell editor
  });
});
