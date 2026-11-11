import { describe, expect, it } from 'vitest';
import { cellsIn, clampRange, normalizeRange, rangeContains, rangeSize } from './range';

describe('range', () => {
  it('normalises corners given in any order', () => {
    expect(normalizeRange({ row: 5, col: 4 }, { row: 2, col: 1 })).toEqual({
      r1: 2,
      c1: 1,
      r2: 5,
      c2: 4,
    });
  });
  it('contains is inclusive on all four edges', () => {
    const r = normalizeRange({ row: 2, col: 1 }, { row: 5, col: 4 });
    expect(rangeContains(r, 2, 1)).toBe(true);
    expect(rangeContains(r, 5, 4)).toBe(true);
    expect(rangeContains(r, 1, 1)).toBe(false);
    expect(rangeContains(r, 2, 5)).toBe(false);
  });
  it('size and iteration agree (500 x 1 fill target)', () => {
    const r = { r1: 0, c1: 3, r2: 499, c2: 3 };
    expect(rangeSize(r)).toBe(500);
    expect([...cellsIn(r)]).toHaveLength(500);
  });
  it('clampRange keeps a range inside the grid', () => {
    expect(clampRange({ r1: -3, c1: -1, r2: 5000, c2: 20 }, { rows: 2000, cols: 9 })).toEqual({
      r1: 0,
      c1: 0,
      r2: 1999,
      c2: 8,
    });
  });
});
