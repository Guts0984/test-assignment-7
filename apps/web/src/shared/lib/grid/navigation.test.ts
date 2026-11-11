import { describe, expect, it } from 'vitest';
import {
  advance,
  arrow,
  arrowToEdge,
  end,
  home,
  page,
  reclamp,
  selectAll,
  single,
} from './navigation';
import { selectionRange } from './range';
import type { Selection } from './types';

const D = { rows: 2000, cols: 9 };
const at = (row: number, col: number) => single({ row, col });
const range = (s: Selection) => selectionRange(s);

describe('arrow keys', () => {
  it('move one cell and collapse the selection', () => {
    expect(arrow(at(5, 3), D, 'down', false)).toEqual(at(6, 3));
    expect(arrow(at(5, 3), D, 'left', false)).toEqual(at(5, 2));
  });
  it('stop at the grid edges (no wrap, no negative index)', () => {
    expect(arrow(at(0, 0), D, 'up', false)).toEqual(at(0, 0));
    expect(arrow(at(0, 0), D, 'left', false)).toEqual(at(0, 0));
    expect(arrow(at(1999, 8), D, 'down', false)).toEqual(at(1999, 8));
    expect(arrow(at(1999, 8), D, 'right', false)).toEqual(at(1999, 8));
  });
  it('Shift extends the range from the anchor; the active cell stays put', () => {
    let s = at(10, 2);
    s = arrow(s, D, 'down', true);
    s = arrow(s, D, 'down', true);
    s = arrow(s, D, 'right', true);
    expect(s.active).toEqual({ row: 10, col: 2 });
    expect(range(s)).toEqual({ r1: 10, c1: 2, r2: 12, c2: 3 });
  });
  it('Shift can shrink the range back and extend past the anchor in the other direction', () => {
    let s = at(10, 2);
    s = arrow(arrow(s, D, 'down', true), D, 'down', true);
    s = arrow(arrow(s, D, 'up', true), D, 'up', true);
    expect(range(s)).toEqual({ r1: 10, c1: 2, r2: 10, c2: 2 });
    s = arrow(s, D, 'up', true);
    expect(range(s)).toEqual({ r1: 9, c1: 2, r2: 10, c2: 2 });
  });
  it('a plain arrow after extending collapses and moves from the active cell', () => {
    let s = arrow(arrow(at(10, 2), D, 'down', true), D, 'down', true);
    s = arrow(s, D, 'right', false);
    expect(s).toEqual(at(10, 3));
  });
  it('Shift never extends outside the grid', () => {
    const s = arrow(at(0, 0), D, 'up', true);
    expect(range(s)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });
  it('an empty grid does not blow up', () => {
    const s = at(0, 0);
    expect(arrow(s, { rows: 0, cols: 9 }, 'down', false)).toBe(s);
    expect(selectAll(s, { rows: 0, cols: 0 })).toBe(s);
    expect(page(s, { rows: 0, cols: 9 }, 10, 'down', false)).toBe(s);
  });
});

describe('Ctrl+arrows, Home/End, PageUp/PageDown', () => {
  it('Ctrl+arrow jumps to the edge', () => {
    expect(arrowToEdge(at(50, 4), D, 'down', false)).toEqual(at(1999, 4));
    expect(arrowToEdge(at(50, 4), D, 'up', false)).toEqual(at(0, 4));
    expect(arrowToEdge(at(50, 4), D, 'right', false)).toEqual(at(50, 8));
    expect(arrowToEdge(at(50, 4), D, 'left', false)).toEqual(at(50, 0));
  });
  it('Ctrl+Shift+arrow extends to the edge', () => {
    expect(range(arrowToEdge(at(50, 4), D, 'down', true))).toEqual({
      r1: 50,
      c1: 4,
      r2: 1999,
      c2: 4,
    });
  });
  it('Home / End go to the first / last column of the row; with Ctrl to the grid corners', () => {
    expect(home(at(7, 5), D, false, false)).toEqual(at(7, 0));
    expect(end(at(7, 5), D, false, false)).toEqual(at(7, 8));
    expect(home(at(7, 5), D, true, false)).toEqual(at(0, 0));
    expect(end(at(7, 5), D, true, false)).toEqual(at(1999, 8));
  });
  it('Shift+Home extends the selection to the row start', () => {
    expect(range(home(at(7, 5), D, false, true))).toEqual({ r1: 7, c1: 0, r2: 7, c2: 5 });
  });
  it('PageDown/PageUp move by a page and clamp', () => {
    expect(page(at(10, 1), D, 20, 'down', false)).toEqual(at(30, 1));
    expect(page(at(10, 1), D, 20, 'up', false)).toEqual(at(0, 1));
    expect(page(at(1990, 1), D, 20, 'down', false)).toEqual(at(1999, 1));
    expect(page(at(10, 1), D, 0, 'down', false)).toEqual(at(11, 1)); // a zero page still moves
  });
  it('Shift+PageDown extends', () => {
    expect(range(page(at(10, 1), D, 20, 'down', true))).toEqual({ r1: 10, c1: 1, r2: 30, c2: 1 });
  });
});

describe('Ctrl+A', () => {
  it('selects every cell and keeps the active cell', () => {
    const s = selectAll(at(40, 3), D);
    expect(range(s)).toEqual({ r1: 0, c1: 0, r2: 1999, c2: 8 });
    expect(s.active).toEqual({ row: 40, col: 3 });
  });
});

describe('Enter / Tab (advance)', () => {
  it('single cell: Enter goes down, Shift+Enter up, Tab right, Shift+Tab left; collapses', () => {
    expect(advance(at(3, 3), D, 'down')).toEqual(at(4, 3));
    expect(advance(at(3, 3), D, 'up')).toEqual(at(2, 3));
    expect(advance(at(3, 3), D, 'right')).toEqual(at(3, 4));
    expect(advance(at(3, 3), D, 'left')).toEqual(at(3, 2));
  });
  it('single cell at an edge stays (Tab on the last column does not wrap to nowhere)', () => {
    expect(advance(at(3, 8), D, 'right')).toEqual(at(3, 8));
    expect(advance(at(0, 0), D, 'up')).toEqual(at(0, 0));
  });
  it('inside a range, Enter walks down the column then wraps to the next column, keeping the range', () => {
    const sel: Selection = {
      active: { row: 5, col: 2 },
      anchor: { row: 5, col: 2 },
      focus: { row: 6, col: 3 },
    };
    let s = advance(sel, D, 'down');
    expect(s.active).toEqual({ row: 6, col: 2 });
    s = advance(s, D, 'down');
    expect(s.active).toEqual({ row: 5, col: 3 }); // wrapped to next column top
    s = advance(s, D, 'down');
    s = advance(s, D, 'down');
    expect(s.active).toEqual({ row: 5, col: 2 }); // wrapped fully
    expect(range(s)).toEqual({ r1: 5, c1: 2, r2: 6, c2: 3 });
  });
  it('inside a range, Tab walks right then wraps to the next row', () => {
    const sel: Selection = {
      active: { row: 5, col: 2 },
      anchor: { row: 5, col: 2 },
      focus: { row: 6, col: 3 },
    };
    let s = advance(sel, D, 'right');
    expect(s.active).toEqual({ row: 5, col: 3 });
    s = advance(s, D, 'right');
    expect(s.active).toEqual({ row: 6, col: 2 });
  });
  it('Shift+Tab / Shift+Enter walk backwards with wrap', () => {
    const sel: Selection = {
      active: { row: 5, col: 2 },
      anchor: { row: 5, col: 2 },
      focus: { row: 6, col: 3 },
    };
    expect(advance(sel, D, 'left').active).toEqual({ row: 6, col: 3 });
    expect(advance(sel, D, 'up').active).toEqual({ row: 6, col: 3 });
  });
});

describe('reclamp', () => {
  it('pulls a selection back into a smaller grid', () => {
    const s = reclamp(at(1500, 8), { rows: 100, cols: 9 });
    expect(s).toEqual(at(99, 8));
  });
  it('returns the same object when nothing changed (no needless re-render)', () => {
    const s = at(3, 3);
    expect(reclamp(s, D)).toBe(s);
  });
  it('becomes null when the grid is empty', () => {
    expect(reclamp(at(3, 3), { rows: 0, cols: 9 })).toBeNull();
  });
});
