import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '@catalog/shared';
import { makeProducts } from '@/shared/api/mocks/data';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { createGridStore } from '../model/grid-store';
import { EDITOR, TestGrid, VIEWER, newProbe } from '../test/harness';

const products = makeProducts(2000);
const bodyRows = () =>
  screen.getAllByRole('row').filter((r) => Number(r.getAttribute('aria-rowindex')) > 1);
const cell = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;

const setup = (opts: Partial<Parameters<typeof TestGrid>[0]> = {}) => {
  const probe = newProbe();
  const store = createGridStore();
  const utils = renderWithProviders(
    <TestGrid initial={products} probe={probe} store={store} {...opts} />,
  );
  return { probe, store, ...utils };
};

describe('virtualization and ARIA', () => {
  it('2000 rows exist for assistive tech but only a screenful is in the DOM', () => {
    setup();
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '2001'); // 2000 + header
    expect(grid).toHaveAttribute('aria-colcount', '9');
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(40);
    expect(document.querySelectorAll('[role="gridcell"]').length).toBeLessThan(40 * 9);
    expect(rows[0]).toHaveAttribute('aria-rowindex', '2'); // row 1 is the header
  });

  it('scrolling mounts the rows around the new position, with correct aria-rowindex', () => {
    setup();
    const vp = screen.getByTestId('grid-viewport');
    act(() => {
      vp.scrollTop = 36 * 1000;
      fireEvent.scroll(vp);
    });
    const idx = bodyRows().map((r) => Number(r.getAttribute('aria-rowindex')));
    expect(Math.min(...idx)).toBeGreaterThan(990);
    expect(Math.min(...idx)).toBeLessThanOrEqual(1003);
    expect(Math.max(...idx)).toBeGreaterThan(1010);
    expect(idx.length).toBeLessThan(40);
    expect(screen.getByText(products[1000]!.sku)).toBeInTheDocument();
    expect(screen.queryByText(products[5]!.sku)).not.toBeInTheDocument();
  });

  it('scrolling to the very end shows the last row and never more than a screenful', () => {
    setup();
    const vp = screen.getByTestId('grid-viewport');
    act(() => {
      vp.scrollTop = 10_000_000;
      fireEvent.scroll(vp);
    });
    const idx = bodyRows().map((r) => Number(r.getAttribute('aria-rowindex')));
    expect(Math.max(...idx)).toBe(2001);
    expect(idx.length).toBeLessThan(40);
  });

  it('header: columnheaders with aria-sort; first column sticky', () => {
    setup({ sort: { field: 'price', dir: 'desc' } });
    const heads = screen.getAllByRole('columnheader');
    expect(heads).toHaveLength(9);
    expect(heads[3]).toHaveAttribute('aria-sort', 'descending');
    expect(heads[0]).toHaveAttribute('aria-sort', 'none');
    expect(heads[0]!.className).toContain('sticky');
    expect(cell(0, 0).className).toContain('sticky');
  });

  it('has no axe violations (grid with data, selection and an error tooltip)', async () => {
    const { container } = setup();
    const user = userEvent.setup();
    await user.click(cell(2, 5));
    await user.keyboard('abc{Enter}'); // invalid stock -> error state
    await expectNoA11yViolations(container);
  });
});

describe('keyboard navigation', () => {
  it('roving tabindex: exactly one cell is tabbable, and it follows the selection', async () => {
    setup();
    const tabbable = () => document.querySelectorAll('[role="gridcell"][tabindex="0"]');
    expect(tabbable()).toHaveLength(1); // before any selection: the first cell
    const user = userEvent.setup();
    await user.click(cell(3, 2));
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]).toBe(cell(3, 2));
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(tabbable()[0]).toBe(cell(4, 3));
    expect(document.activeElement).toBe(cell(4, 3)); // real DOM focus moves too
  });

  it('arrows, Home/End, Ctrl+Home/End, PageDown/PageUp', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(cell(10, 4));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cell(10, 0));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cell(10, 8));
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(document.activeElement).toBe(cell(0, 0));
    await user.keyboard('{PageDown}');
    const row = Number(document.activeElement!.getAttribute('data-row'));
    expect(row).toBeGreaterThan(8);
    expect(row).toBeLessThan(20);
    await user.keyboard('{PageUp}');
    expect(document.activeElement!.getAttribute('data-row')).toBe('0');
    await user.keyboard('{Control>}{End}{/Control}');
    expect(document.activeElement!.getAttribute('data-row')).toBe('1999');
    expect(document.activeElement!.getAttribute('data-col')).toBe('8');
  });

  it('moving far away keeps the focused row mounted and scrolls to it', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{Control>}{ArrowDown}{/Control}');
    expect(document.activeElement).toHaveAttribute('data-row', '1999');
    const idx = bodyRows().map((r) => Number(r.getAttribute('aria-rowindex')));
    expect(Math.max(...idx)).toBe(2001);
  });

  it('Shift+PageDown keeps scrolling after the selection: the moving corner stays in view', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{Shift>}{PageDown}{PageDown}{PageDown}{/Shift}');
    const s = store.getState().selection!;
    expect(s.focus.row).toBeGreaterThan(20);
    const viewport = screen.getByTestId('grid-viewport');
    expect(viewport.scrollTop).toBeGreaterThan(0); // followed the corner, not the anchor
    expect(cell(s.focus.row, s.focus.col)).toBeInTheDocument(); // and it is mounted
  });

  it('Shift+click after wheel-scrolling does not throw the view back to the anchor', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    const viewport = screen.getByTestId('grid-viewport');
    act(() => {
      viewport.scrollTop = 40 * 600;
      fireEvent.scroll(viewport);
    });
    const mid = bodyRows();
    const target = mid[Math.floor(mid.length / 2)]!.querySelector<HTMLElement>(
      '[role="gridcell"][data-col="2"]',
    )!;
    const row = Number(target.getAttribute('data-row'));
    expect(row).toBeGreaterThan(500);
    fireEvent.mouseDown(target, { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    expect(store.getState().selection!.focus.row).toBe(row);
    expect(viewport.scrollTop).toBe(40 * 600); // not reset to the top
  });

  it('Ctrl+A does not move the view', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(cell(3, 1));
    const viewport = screen.getByTestId('grid-viewport');
    const before = viewport.scrollTop;
    await user.keyboard('{Control>}a{/Control}');
    expect(viewport.scrollTop).toBe(before);
  });

  it('a new sort/filter: the selection follows the PRODUCT, it does not silently point at another one', async () => {
    const { store, probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(2, 1));
    const id = products[2]!.id;
    act(() => probe.setRows([...products].reverse())); // e.g. sorted the other way
    const s = store.getState().selection!;
    expect(s.active).toEqual({ row: 1997, col: 1 });
    expect(s.anchor).toEqual(s.focus); // collapsed to that one product
    expect([...products].reverse()[s.active.row]!.id).toBe(id);
  });

  it('a filter that hides the selected product drops the selection', async () => {
    const { store, probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(2, 1));
    act(() => probe.setRows(products.filter((_, i) => i !== 2)));
    expect(store.getState().selection).toBeNull();
  });

  it('rows changing WITHOUT a reorder (an edit, a refetch) keep the selection untouched', async () => {
    const { store, probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(2, 1));
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    const before = store.getState().selection;
    act(() => probe.setRows(products.map((p) => ({ ...p, stock: p.stock + 1 }))));
    expect(store.getState().selection).toBe(before);
  });

  it('on a Mac Ctrl+C is not a copy: focus stays on the cell and the arrows keep working (Cmd+C is the copy)', async () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      setup();
      const user = userEvent.setup();
      await user.click(cell(3, 2));
      await user.keyboard('{Control>}c{/Control}');
      expect(document.activeElement).toBe(cell(3, 2)); // NOT the hidden clipboard field
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(cell(4, 2));
      await user.keyboard('{Meta>}c{/Meta}');
      expect(document.activeElement).toHaveAttribute('data-clip-proxy'); // Cmd+C takes the copy path
    } finally {
      platform.mockRestore();
    }
  });

  it('Tab on a single cell is not swallowed (no keyboard trap); inside a range it walks the range like Excel', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(3, 2));
    const down = fireEvent.keyDown(cell(3, 2), { key: 'Tab' });
    expect(down).toBe(true); // not preventDefault()-ed: the browser moves focus out of the grid
    expect(store.getState().selection!.active).toEqual({ row: 3, col: 2 });
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    const inRange = fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(inRange).toBe(false); // handled by the grid
    expect(store.getState().selection!.active).toEqual({ row: 3, col: 3 });
  });

  it('errors on cells that are NOT active (a failed save, a refused paste) are announced too', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    expect(screen.queryByTestId('grid-error-live')).toBeNull(); // nothing to announce yet
    act(() => {
      store
        .getState()
        .setErrors({ [`${products[7]!.id}:price`]: { code: 'invalid', field: 'price' } });
    });
    const live = screen.getByTestId('grid-error-live');
    expect(live).toHaveTextContent(`${products[7]!.sku} Price: This value is not valid.`);
    act(() => {
      store.getState().setErrors({
        [`${products[8]!.id}:price`]: { code: 'invalid', field: 'price' },
        [`${products[9]!.id}:price`]: { code: 'invalid', field: 'price' },
      });
    });
    expect(live).toHaveTextContent('2 cells have errors.');
  });

  it('a column cannot be dragged wider than 600px, same as with the keyboard', async () => {
    const { store } = setup();
    const handle = screen.getByLabelText('Resize column Name');
    handle.setPointerCapture = vi.fn(); // not implemented by jsdom
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 });
    expect(store.getState().colWidths.name).toBe(600);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(store.getState().colWidths.name).toBe(600);
  });

  it('Shift+Arrows select a range; Ctrl+A selects all; Esc collapses', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(5, 1));
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{ArrowRight}{/Shift}');
    expect(cell(5, 1)).toHaveAttribute('aria-selected', 'true');
    expect(cell(7, 2)).toHaveAttribute('aria-selected', 'true');
    expect(cell(8, 2)).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('6 cells selected');
    await user.keyboard('{Control>}a{/Control}');
    expect(store.getState().selection).toMatchObject({
      anchor: { row: 0, col: 0 },
      focus: { row: 1999, col: 8 },
      active: { row: 5, col: 1 },
    });
    await user.keyboard('{Escape}');
    const s = store.getState().selection!;
    expect(s.anchor).toEqual(s.focus);
  });

  it('mouse drag selects a range; Shift+click extends it', async () => {
    const { store } = setup();
    fireEvent.mouseDown(cell(2, 1), { button: 0 });
    fireEvent.mouseOver(cell(4, 3));
    fireEvent.mouseUp(window);
    expect(store.getState().selection).toMatchObject({
      anchor: { row: 2, col: 1 },
      focus: { row: 4, col: 3 },
    });
    fireEvent.mouseDown(cell(6, 1), { button: 0, shiftKey: true });
    expect(store.getState().selection).toMatchObject({
      anchor: { row: 2, col: 1 },
      focus: { row: 6, col: 1 },
    });
    // moving the mouse after release does not keep selecting
    fireEvent.mouseUp(window);
    fireEvent.mouseOver(cell(9, 4));
    expect(store.getState().selection!.focus).toEqual({ row: 6, col: 1 });
  });

  it('forwards undo/redo intents to the page', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(1, 1));
    await user.keyboard('{Control>}z{/Control}{Control>}{Shift>}z{/Shift}{/Control}');
    expect(probe.commands).toEqual(['undo', 'redo']);
  });
});

describe('keyboard entry', () => {
  it('Tab-ing into the grid focuses the first cell, and the very next arrow key moves from it', async () => {
    const { store } = setup();
    cell(0, 0).focus(); // what Tab does: DOM focus, no mouse click
    expect(store.getState().selection?.active).toEqual({ row: 0, col: 0 });
    await userEvent.setup().keyboard('{ArrowDown}{ArrowRight}');
    expect(document.activeElement).toBe(cell(1, 1));
  });
});

describe('editing from the keyboard', () => {
  it('typing starts an edit with that character; Enter commits and moves down', async () => {
    const { probe, store } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('N');
    const editor = screen.getByRole('textbox', { name: 'Name' });
    expect(editor).toHaveValue('N');
    await user.keyboard('ew name{Enter}');
    expect(probe.commits).toEqual([
      { edits: [{ id: products[0]!.id, field: 'name', value: 'New name' }], source: 'edit' },
    ]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(store.getState().selection!.active).toEqual({ row: 1, col: 1 });
    expect(document.activeElement).toBe(cell(1, 1));
    expect(cell(0, 1)).toHaveTextContent('New name');
  });

  it('F2 and Enter open the editor with the current value selected', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}');
    const ed = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(ed.value).toBe(products[0]!.name);
    expect(ed.selectionStart).toBe(0);
    expect(ed.selectionEnd).toBe(ed.value.length);
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  });

  it('double click opens the editor', async () => {
    setup();
    const user = userEvent.setup();
    await user.dblClick(cell(0, 1));
    // it opens on the CURRENT value, not on an empty draft (Enter would save an empty name)
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      products[0]!.name,
    );
  });

  it('a double click INSIDE an open editor (word selection) does not wipe the draft', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}');
    const ed = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    await user.dblClick(ed);
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      products[0]!.name,
    );
  });

  it('Esc cancels: no change, no request, value restored', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}zzz{Escape}');
    expect(probe.commits).toHaveLength(0);
    expect(cell(0, 1)).toHaveTextContent(products[0]!.name);
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it('Tab commits and moves right; Shift+Tab left; Shift+Enter up', async () => {
    const { store } = setup();
    const user = userEvent.setup();
    await user.click(cell(3, 1));
    await user.keyboard('{F2}{Tab}');
    expect(store.getState().selection!.active).toEqual({ row: 3, col: 2 });
    await user.keyboard('{F2}{Shift>}{Tab}{/Shift}');
    expect(store.getState().selection!.active).toEqual({ row: 3, col: 1 });
    await user.keyboard('{F2}{Shift>}{Enter}{/Shift}');
    expect(store.getState().selection!.active).toEqual({ row: 2, col: 1 });
  });

  it('an unchanged value is not a change: no request', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}{Enter}');
    expect(probe.commits).toHaveLength(0);
  });

  it('invalid input stays in the editor, is marked invalid, explained in a tooltip, and is NOT sent', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 5)); // stock
    await user.keyboard('1.5{Enter}');
    expect(probe.commits).toHaveLength(0);
    const ed = screen.getByRole('textbox', { name: 'Stock' });
    expect(ed).toHaveAttribute('aria-invalid', 'true');
    expect(cell(0, 5)).toHaveAttribute('aria-invalid', 'true');
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Enter a whole number.');
    expect(ed).toHaveAttribute('aria-describedby', tip.id);
    // the tooltip exists only on the active cell: a screen reader is told through an assertive live region
    const live = await screen.findByTestId('grid-error-live');
    expect(live).toHaveAttribute('role', 'alert');
    expect(live).toHaveTextContent(`${products[0]!.sku} Stock: Enter a whole number.`);
    // fixing the value clears the error and sends it
    await user.clear(ed);
    await user.keyboard('7{Enter}');
    expect(probe.commits).toHaveLength(1);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cross-field error: oldPrice <= price is flagged on the cell and not sent', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    const r = products.findIndex((p) => p.price !== null);
    await user.click(cell(r, 4));
    await user.keyboard(`${products[r]!.price}{Enter}`); // equal to price
    expect(probe.commits).toHaveLength(0);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Old price must be greater than the price.',
    );
  });

  it('numbers are parsed by locale: Ukrainian "1 234,5" -> 1234.50', async () => {
    const { probe } = setup({ locale: 'uk' });
    const user = userEvent.setup();
    const r = products.findIndex(
      (p) => p.price !== null && p.oldPrice === null && p.status === 'active',
    );
    await user.click(cell(r, 3));
    await user.keyboard('1 234,5{Enter}');
    expect(probe.commits[0]!.edits[0]).toMatchObject({ field: 'price', value: '1234.50' });
  });

  it('the same text in English is refused when it would be ambiguous', async () => {
    const { probe } = setup({ locale: 'en' });
    const user = userEvent.setup();
    await user.click(cell(0, 3));
    await user.keyboard('1,5{Enter}');
    expect(probe.commits).toHaveLength(0);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('a select column edits with a listbox; typing a letter jumps to the matching option', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    const r = products.findIndex(
      (p) => p.status === 'draft' && p.price !== null && p.category !== null,
    );
    await user.click(cell(r, 6)); // status
    await user.keyboard('A'); // "Active"
    const sel = screen.getByRole('combobox', { name: 'Status' });
    expect(sel).toHaveValue('active');
    await user.keyboard('{Enter}');
    expect(probe.commits[0]!.edits[0]).toMatchObject({ field: 'status', value: 'active' });
  });

  it('tags edit as comma separated text', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 7));
    await user.keyboard('{F2}{Control>}a{/Control}x, y,x{Enter}');
    expect(probe.commits[0]!.edits[0]).toMatchObject({ field: 'tags', value: ['x', 'y'] });
  });

  it('clicking another cell while editing commits the edit (like Excel)', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, 1));
    await user.keyboard('Q');
    await user.click(cell(4, 1));
    expect(probe.commits[0]!.edits[0]).toMatchObject({ field: 'name', value: 'Q' });
  });
});

describe('read-only cells', () => {
  it('viewer: every cell is aria-readonly and typing explains why instead of editing', async () => {
    setup({ me: VIEWER });
    const user = userEvent.setup();
    expect(cell(0, 1)).toHaveAttribute('aria-readonly', 'true');
    expect(cell(0, 1).className).toContain('bg-readonly');
    await user.click(cell(0, 1));
    await user.keyboard('x');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('You cannot edit this product.');
    await user.keyboard('{F2}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.dblClick(cell(0, 1));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('editor: own categories editable, foreign ones read-only (still visible)', () => {
    setup({ me: EDITOR });
    const own = products.findIndex((p) => p.category && EDITOR.categories.includes(p.category));
    const foreign = products.findIndex(
      (p) => p.category && !EDITOR.categories.includes(p.category),
    );
    const check = (i: number) => {
      const el = cell(i, 1);
      expect(el).toBeTruthy();
      return el.getAttribute('aria-readonly');
    };
    // rows 0..14 are mounted; find within them
    const mountedOwn = [...Array(15).keys()].find(
      (i) => products[i]!.category && EDITOR.categories.includes(products[i]!.category!),
    )!;
    const mountedForeign = [...Array(15).keys()].find(
      (i) => products[i]!.category && !EDITOR.categories.includes(products[i]!.category!),
    )!;
    expect(check(mountedOwn)).toBeNull();
    expect(check(mountedForeign)).toBe('true');
    expect(own).toBeGreaterThanOrEqual(0);
    expect(foreign).toBeGreaterThanOrEqual(0);
  });

  it('read-only status is spoken, not just coloured', () => {
    setup({ me: VIEWER });
    expect(cell(0, 1).getAttribute('aria-label')).toMatch(/read only/);
  });
});

describe('header: sorting and resizing', () => {
  it('clicking a header requests a sort by that column', async () => {
    const onSort = vi.fn();
    setup({ onSort });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sort by Price' }));
    expect(onSort).toHaveBeenCalledWith('price');
  });
  it('column width is changeable from the keyboard and drives every cell via a CSS variable (no re-render of rows)', async () => {
    const { store } = setup();
    const sep = screen.getByRole('separator', { name: 'Resize column Name' });
    expect(sep).toHaveAttribute('aria-valuenow', '240');
    sep.focus();
    await userEvent.setup().keyboard('{ArrowRight}{ArrowRight}');
    expect(store.getState().colWidths.name).toBe(260);
    expect(screen.getByTestId('grid-viewport').style.getPropertyValue('--w-1')).toBe('260px');
  });
  it('never narrower than the column minimum', async () => {
    const { store } = setup();
    const sep = screen.getByRole('separator', { name: 'Resize column Name' });
    sep.focus();
    await userEvent.setup().keyboard('{ArrowLeft>30/}');
    expect(store.getState().colWidths.name).toBe(120);
  });
});

describe('re-rendering: changing one cell re-renders only that cell (not the table)', () => {
  it('a single value change calls the cell formatter exactly once', async () => {
    const entities = await import('@/entities/product');
    const spy = vi.spyOn(entities, 'displayText');
    const { probe } = setup();
    const visibleCells = document.querySelectorAll('[role="gridcell"]').length;
    expect(visibleCells).toBeGreaterThan(100);
    spy.mockClear();
    act(() => {
      const cur = products.map((p) => ({ ...p }));
      cur[3] = { ...cur[3]!, stock: 424242 }; // exactly one cell changes; the other rows keep their identity
      probe.setRows(products.map((p, i) => (i === 3 ? cur[3]! : p)));
    });
    expect(cell(3, 5)).toHaveTextContent('424,242');
    // Every Cell render formats its value, so N calls == N cells re-rendered.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(['stock', 424242, 'en']);
    spy.mockRestore();
  });

  it('moving the selection re-renders only the cells entering/leaving it', async () => {
    const entities = await import('@/entities/product');
    const spy = vi.spyOn(entities, 'displayText');
    setup();
    const user = userEvent.setup();
    await user.click(cell(5, 2));
    spy.mockClear();
    await user.keyboard('{ArrowDown}');
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2); // the cell left + the cell entered
    spy.mockRestore();
  });

  it('saving state of one cell does not touch the others', async () => {
    const entities = await import('@/entities/product');
    const spy = vi.spyOn(entities, 'displayText');
    const { store } = setup();
    spy.mockClear();
    act(() => store.getState().setSaving({ [`${products[2]!.id}:price`]: true }));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(within(cell(2, 3)).queryByText(/./)).toBeTruthy();
    spy.mockRestore();
  });
});

describe('empty and shrinking grids', () => {
  it('an empty list renders a message, not rows, and stays accessible', async () => {
    const probe = newProbe();
    const { container } = renderWithProviders(<TestGrid initial={[]} probe={probe} />);
    expect(screen.getByText('No products match the filters.')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '1');
    await expectNoA11yViolations(container);
  });
  it('a list that shrinks below the selected product drops the selection (it must not slide onto another product)', async () => {
    const { store, probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(10, 1));
    act(() => probe.setRows(products.slice(0, 5) as ProductRow[]));
    expect(store.getState().selection).toBeNull();
  });
});
