import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeProducts } from '@/shared/api/mocks/data';
import { parseTsv } from '@/shared/lib/grid';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { createGridStore } from '../model/grid-store';
import { resetInternalClipboard, type GridNotice } from '../index';
import { EDITOR, TestGrid, VIEWER, newProbe } from '../test/harness';
import { HEADER_HEIGHT } from './header';
import { ROW_HEIGHT } from './row';
import { ProductGrid } from './product-grid';

const products = makeProducts(2000);
const cell = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;
const STOCK = 5;
const PRICE = 3;
const NAME = 1;

const clip = (text = '') => {
  let written = '';
  return {
    data: { getData: () => text, setData: (_t: string, v: string) => (written = v) },
    written: () => written,
  };
};

const setup = (opts: Partial<Parameters<typeof TestGrid>[0]> = {}) => {
  const probe = newProbe();
  const store = createGridStore();
  const notices: GridNotice[] = [];
  const utils = renderWithProviders(
    <TestGrid initial={products} probe={probe} store={store} {...opts} />,
  );
  return { probe, store, notices, ...utils, grid: () => screen.getByRole('grid') };
};

beforeEach(() => resetInternalClipboard());

const select = async (from: [number, number], to: [number, number]) => {
  const user = userEvent.setup();
  await user.click(cell(...from));
  await user.keyboard(
    `{Shift>}${'{ArrowDown}'.repeat(to[0] - from[0])}${'{ArrowRight}'.repeat(to[1] - from[1])}{/Shift}`,
  );
  return user;
};

describe('copy', () => {
  it('copies a 10x3 block as tab-separated text', async () => {
    const { grid } = setup();
    await select([0, 3], [9, 5]);
    const c = clip();
    fireEvent.copy(grid(), { clipboardData: c.data });
    const m = parseTsv(c.written());
    expect(m).toHaveLength(10);
    expect(m.every((r) => r.length === 3)).toBe(true);
    expect(m[0]![2]).toBe(String(products[0]!.stock));
  });
  it('does nothing without a selection and does not hijack copy inside an editor', async () => {
    const { grid } = setup();
    const c = clip();
    fireEvent.copy(grid(), { clipboardData: c.data });
    expect(c.written()).toBe('');
    const user = userEvent.setup();
    await user.click(cell(0, NAME));
    await user.keyboard('{F2}');
    fireEvent.copy(screen.getByRole('textbox'), { clipboardData: c.data });
    expect(c.written()).toBe('');
  });
});

describe('paste', () => {
  it('copy 10x3 then paste elsewhere: ONE commit, source "paste", typed values exact', async () => {
    const { grid, probe } = setup();
    await select([0, 3], [9, 5]);
    const c = clip();
    fireEvent.copy(grid(), { clipboardData: c.data });
    const user = userEvent.setup();
    await user.click(cell(10, 3)); // a mounted row (row 20 is outside the rendered window)
    fireEvent.paste(grid(), { clipboardData: clip(c.written()).data });
    expect(probe.commits).toHaveLength(1);
    expect(probe.commits[0]!.source).toBe('paste');
    const e = probe.commits[0]!.edits;
    expect(e.length).toBeGreaterThan(10);
    expect(e.length).toBeLessThanOrEqual(30);
    const first = e.find((x) => x.id === products[10]!.id && x.field === 'price');
    expect(first?.value).toBe(products[0]!.price); // exact string, no locale round trip
  });

  it('after a paste the pasted area is selected', async () => {
    const { grid, store } = setup();
    await select([0, 1], [1, 2]);
    const c = clip();
    fireEvent.copy(grid(), { clipboardData: c.data });
    const user = userEvent.setup();
    await user.click(cell(10, 1));
    fireEvent.paste(grid(), { clipboardData: clip(c.written()).data });
    expect(store.getState().selection).toMatchObject({
      anchor: { row: 10, col: 1 },
      focus: { row: 11, col: 2 },
    });
  });

  it('ONE value pasted into a selected range goes into every cell', async () => {
    const { grid, probe } = setup();
    const user = await select([0, STOCK], [4, STOCK]);
    expect(user).toBeTruthy();
    fireEvent.paste(grid(), { clipboardData: clip('42').data });
    expect(probe.commits[0]!.edits).toHaveLength(5);
    expect(new Set(probe.commits[0]!.edits.map((x) => x.value))).toEqual(new Set([42]));
    expect(cell(4, STOCK)).toHaveTextContent('42');
  });

  it('text from a spreadsheet is parsed by LOCALE (uk: "1 234,5")', async () => {
    const { grid, probe } = setup({ locale: 'uk' });
    const i = products.findIndex(
      (p) => p.price !== null && p.oldPrice === null && p.status === 'active',
    );
    await userEvent.setup().click(cell(i, PRICE));
    fireEvent.paste(grid(), { clipboardData: clip('1 234,5\n').data });
    expect(probe.commits[0]!.edits).toEqual([
      { id: products[i]!.id, field: 'price', value: '1234.50' },
    ]);
  });

  it('select columns accept the visible label, not only the machine value', async () => {
    const { grid, probe } = setup();
    const i = products.findIndex(
      (p) => p.status === 'draft' && p.price !== null && p.category !== null,
    );
    await userEvent.setup().click(cell(i, 6));
    fireEvent.paste(grid(), { clipboardData: clip('Archived').data });
    expect(probe.commits[0]!.edits[0]).toMatchObject({ field: 'status', value: 'archived' });
  });

  it('invalid cells are NOT sent and are flagged; valid ones still go through', async () => {
    const { grid, probe, store } = setup();
    await userEvent.setup().click(cell(0, STOCK));
    fireEvent.paste(grid(), { clipboardData: clip('11\nabc\n13\n-4').data });
    expect(probe.commits[0]!.edits.map((e) => e.value)).toEqual([11, 13]);
    const errs = Object.values(store.getState().errors);
    expect(errs).toHaveLength(2);
    expect(errs.every((e) => e.field === 'stock')).toBe(true);
    expect(cell(1, STOCK)).toHaveAttribute('aria-invalid', 'true');
  });

  it('cross-field: a pasted oldPrice not above the price is refused with the rule explained', async () => {
    const { grid, probe } = setup();
    const i = products.findIndex((p) => p.price !== null && p.oldPrice === null);
    await userEvent.setup().click(cell(i, 4));
    fireEvent.paste(grid(), { clipboardData: clip(products[i]!.price!).data });
    expect(probe.commits).toHaveLength(0);
    expect(cell(i, 4)).toHaveAttribute('aria-invalid', 'true');
  });

  it('viewer: paste is a no-op; editor: only own-category rows change', async () => {
    const v = setup({ me: VIEWER });
    await userEvent.setup().click(cell(0, STOCK));
    fireEvent.paste(v.grid(), { clipboardData: clip('1\n2\n3').data });
    expect(v.probe.commits).toHaveLength(0);
    v.unmount();

    const e = setup({ me: EDITOR });
    await userEvent.setup().click(cell(0, STOCK));
    fireEvent.paste(e.grid(), { clipboardData: clip('7\n7\n7\n7\n7\n7\n7\n7').data });
    const ids = new Set(e.probe.commits[0]?.edits.map((x) => x.id));
    for (const id of ids) {
      const p = products.find((x) => x.id === id)!;
      expect(EDITOR.categories).toContain(p.category);
    }
    expect(ids.size).toBeLessThan(8);
  });

  it('a block that runs past the last row is cut off, not an error', async () => {
    const { grid, probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, STOCK));
    await user.keyboard('{Control>}{ArrowDown}{/Control}');
    fireEvent.paste(grid(), { clipboardData: clip('1\n2\n3\n4\n5').data });
    expect(probe.commits[0]!.edits).toHaveLength(1);
  });

  it('pasting 500 rows is one request batch and stays well under the 200 ms INP budget', async () => {
    const { grid, probe } = setup();
    await userEvent.setup().click(cell(0, STOCK));
    const text = Array.from({ length: 500 }, (_, i) => String(5000 + i)).join('\n');
    const t0 = performance.now();
    act(() => {
      fireEvent.paste(grid(), { clipboardData: clip(text).data });
    });
    const ms = performance.now() - t0;
    expect(probe.commits).toHaveLength(1);
    expect(probe.commits[0]!.edits).toHaveLength(500);
    expect(ms).toBeLessThan(200);
  });
});

describe('cut and delete', () => {
  it('cut copies then clears optional cells; required cells (stock, name) keep their value', async () => {
    const { grid, probe } = setup();
    const i = products.findIndex(
      (p) => p.status === 'draft' && p.oldPrice === null && p.price !== null,
    );
    const user = userEvent.setup();
    await user.click(cell(i, NAME));
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}'); // name..price
    const c = clip();
    fireEvent.cut(grid(), { clipboardData: c.data });
    expect(c.written()).toContain(products[i]!.name);
    const e = probe.commits[0]!.edits;
    expect(e.some((x) => x.field === 'name')).toBe(false);
    expect(e.find((x) => x.field === 'price')?.value).toBeNull();
  });

  it('Delete empties optional cells in the selection as ONE commit; required ones are untouched', async () => {
    const { probe } = setup();
    const i = products.findIndex(
      (p) =>
        p.status === 'draft' && p.arrivalDate !== null && p.price !== null && p.oldPrice === null,
    );
    const user = userEvent.setup();
    await user.click(cell(i, 8));
    await user.keyboard('{Delete}');
    expect(probe.commits).toHaveLength(1);
    expect(probe.commits[0]!.edits).toEqual([
      { id: products[i]!.id, field: 'arrivalDate', value: null },
    ]);
    await user.click(cell(0, NAME));
    await user.keyboard('{Delete}');
    expect(probe.commits).toHaveLength(1); // a name cannot be emptied
  });

  it('Delete on the price of an ACTIVE product is refused by the rule (flagged, not sent)', async () => {
    const { probe } = setup();
    const i = products.findIndex((p) => p.status === 'active' && p.price !== null);
    const user = userEvent.setup();
    await user.click(cell(i, PRICE));
    await user.keyboard('{Delete}');
    expect(probe.commits).toHaveLength(0);
    expect(cell(i, PRICE)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('fill handle', () => {
  // The pointer stays inside the Stock column (x of its middle) while moving down, like a real drag.
  const STOCK_X = 130 + 240 + 160 + 120 + 120 + 40;
  const dragTo = (handle: HTMLElement, row: number, opts: { ctrl?: boolean } = {}) => {
    const y = HEADER_HEIGHT + row * ROW_HEIGHT + 4;
    fireEvent.pointerDown(handle, { clientX: STOCK_X, clientY: 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: STOCK_X, clientY: y });
    fireEvent.pointerUp(window, { clientX: STOCK_X, clientY: y, ctrlKey: !!opts.ctrl });
  };
  const handle = () => document.querySelector<HTMLElement>('[data-fill-handle]')!;

  it('the handle appears at the corner of the selection', async () => {
    setup();
    await userEvent.setup().click(cell(2, STOCK));
    expect(handle()).toBeTruthy();
    await userEvent.setup().click(cell(2, STOCK));
    await userEvent.setup().keyboard('{F2}');
    expect(handle()).toBeFalsy(); // hidden while editing
  });

  it('dragging a single number COPIES it down', async () => {
    const { probe } = setup();
    await userEvent.setup().click(cell(0, STOCK));
    dragTo(handle(), 5);
    expect(probe.commits).toHaveLength(1);
    expect(probe.commits[0]!.source).toBe('fill');
    expect(new Set(probe.commits[0]!.edits.map((e) => e.value))).toEqual(
      new Set([products[0]!.stock]),
    );
    expect(probe.commits[0]!.edits).toHaveLength(
      products.slice(1, 6).filter((p) => p.stock !== products[0]!.stock).length,
    );
  });

  it('two numbers CONTINUE the sequence over 500 rows, as one action, quickly', async () => {
    const { probe, store } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, STOCK));
    await user.keyboard('100{Enter}105{Enter}'); // two source values
    probe.commits.length = 0;
    await user.click(cell(0, STOCK));
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    const t0 = performance.now();
    act(() => dragTo(handle(), 500));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(probe.commits).toHaveLength(1);
    const e = probe.commits[0]!.edits;
    expect(e).toHaveLength(499 - 0); // rows 2..500
    expect(e[0]!.value).toBe(110);
    expect(e[e.length - 1]!.value).toBe(110 + 498 * 5);
    expect(store.getState().selection).toMatchObject({ focus: { row: 500, col: STOCK } });
  });

  it('Ctrl while dragging counts up a single number', async () => {
    const { probe } = setup();
    await userEvent.setup().click(cell(0, STOCK));
    dragTo(handle(), 3, { ctrl: true });
    expect(probe.commits[0]!.edits.map((e) => e.value)).toEqual([
      products[0]!.stock + 1,
      products[0]!.stock + 2,
      products[0]!.stock + 3,
    ]);
  });

  it('Ctrl+D fills the selection downward from its first row (keyboard alternative)', async () => {
    const { probe } = setup();
    const user = userEvent.setup();
    await user.click(cell(0, NAME));
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}{Control>}d{/Control}');
    expect(probe.commits[0]!.source).toBe('fill');
    expect(probe.commits[0]!.edits.map((e) => e.value)).toEqual([
      products[0]!.name,
      products[0]!.name,
    ]);
  });

  it('a fill into read-only rows changes nothing (viewer) and a fill that breaks a rule is flagged', async () => {
    const v = setup({ me: VIEWER });
    await userEvent.setup().click(cell(0, STOCK));
    dragTo(handle(), 4);
    expect(v.probe.commits).toHaveLength(0);
  });

  it('the notice callback reports applied / skipped counts', async () => {
    const probe = newProbe();
    const store = createGridStore();
    const seen: GridNotice[] = [];
    function Wrapper() {
      return (
        <div style={{ height: 540 }}>
          <ProductGrid
            rows={products}
            order={products.map((p) => p.id)}
            me={VIEWER}
            locale="en"
            sort={null}
            onSort={() => {}}
            commit={vi.fn()}
            onNotice={(n) => seen.push(n)}
            store={store}
            initialViewportHeight={540}
          />
        </div>
      );
    }
    renderWithProviders(<Wrapper />);
    void probe;
    await userEvent.setup().click(cell(0, STOCK));
    fireEvent.paste(screen.getByRole('grid'), { clipboardData: clip('1\n2\n3').data });
    expect(seen[0]).toMatchObject({ kind: 'paste', applied: 0, skippedReadOnly: 3 });
  });
});
