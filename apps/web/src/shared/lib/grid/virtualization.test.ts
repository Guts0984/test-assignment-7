import { describe, expect, it } from 'vitest';
import { computeWindow, rowsToMount, scrollTopToReveal } from './virtualization';

const base = { rowHeight: 36, rowCount: 2000, viewportHeight: 720 };

describe('computeWindow', () => {
  it('renders only a screenful of 2000 rows (20 visible + overscan), not all of them', () => {
    const w = computeWindow({ ...base, scrollTop: 0, overscan: 5 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(24); // rows 0..19 visible + 5 overscan
    expect(w.end - w.start + 1).toBeLessThan(40);
    expect(w.totalHeight).toBe(72_000);
  });

  it('is stable mid-list and offsets the window correctly', () => {
    const w = computeWindow({ ...base, scrollTop: 36 * 1000 + 10, overscan: 3 });
    expect(w.start).toBe(997);
    expect(w.offsetTop).toBe(997 * 36);
    expect(w.end).toBeGreaterThanOrEqual(1020);
    expect(w.end).toBeLessThanOrEqual(1024);
  });

  it('clamps at the bottom (overscroll / elastic scroll) and shows the last row', () => {
    const w = computeWindow({ ...base, scrollTop: 10_000_000, overscan: 0 });
    expect(w.end).toBe(1999);
    expect(w.start).toBe(1980);
  });

  it('clamps negative scroll (rubber-band) to the top', () => {
    expect(computeWindow({ ...base, scrollTop: -500 }).start).toBe(0);
  });

  it.each([
    ['no rows', { ...base, rowCount: 0, scrollTop: 0 }],
    ['zero viewport', { ...base, viewportHeight: 0, scrollTop: 0 }],
    ['zero row height', { ...base, rowHeight: 0, scrollTop: 0 }],
  ])('%s -> empty window, no NaN', (_n, p) => {
    const w = computeWindow(p);
    expect(w.end).toBeLessThan(w.start);
    expect(Number.isNaN(w.totalHeight)).toBe(false);
  });

  it('fewer rows than the viewport: renders all of them', () => {
    const w = computeWindow({ ...base, rowCount: 7, scrollTop: 0 });
    expect([w.start, w.end]).toEqual([0, 6]);
  });

  it('a partially visible row at both edges is included', () => {
    const w = computeWindow({
      rowHeight: 10,
      rowCount: 100,
      viewportHeight: 25,
      scrollTop: 15,
      overscan: 0,
    });
    expect([w.start, w.end]).toEqual([1, 3]); // px 15..40: row 1 (partly), 2, 3 (ends exactly at 40)
  });

  it('never returns out-of-range indices for any scroll position', () => {
    for (let s = -100; s < 80_000; s += 137) {
      const w = computeWindow({ ...base, scrollTop: s, overscan: 7 });
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(1999);
      expect(w.end - w.start + 1).toBeLessThanOrEqual(20 + 1 + 14 + 1);
    }
  });
});

describe('rowsToMount', () => {
  const w = computeWindow({ ...base, scrollTop: 0, overscan: 0 });
  it('keeps the focused row mounted even when scrolled far away (roving tabindex target)', () => {
    const rows = rowsToMount(w, [1500], 2000);
    expect(rows).toContain(1500);
    expect(rows.length).toBe(w.end - w.start + 2);
  });
  it('does not duplicate rows already in the window and ignores stale indices', () => {
    const rows = rowsToMount(w, [3, 9999, -1], 2000);
    expect(rows.filter((r) => r === 3)).toHaveLength(1);
    expect(rows).not.toContain(9999);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });
});

describe('scrollTopToReveal', () => {
  const p = { viewportHeight: 360, rowHeight: 36, headerHeight: 36 };
  it('does nothing when the row is already visible', () => {
    expect(scrollTopToReveal({ ...p, row: 3, scrollTop: 0 })).toBe(0);
  });
  it('scrolls up so a row above the viewport becomes the first visible one', () => {
    expect(scrollTopToReveal({ ...p, row: 2, scrollTop: 500 })).toBe(72);
  });
  it('scrolls down so a row below ends flush with the bottom, accounting for the sticky header', () => {
    expect(scrollTopToReveal({ ...p, row: 20, scrollTop: 0 })).toBe(21 * 36 - (360 - 36));
  });
});
