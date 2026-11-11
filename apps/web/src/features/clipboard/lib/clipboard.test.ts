import { describe, expect, it } from 'vitest';
import { parseTsv } from '@/shared/lib/grid';
import { makeProducts } from '@/shared/api/mocks/data';
import { buildCopy, planPasteTargets } from './clipboard';

const rows = makeProducts(30);
const label = (_f: 'category' | 'status', v: string) => v.toUpperCase();

describe('buildCopy', () => {
  it('10x3 block -> 10 lines of 3 tab-separated cells, localised', () => {
    const c = buildCopy({ r1: 0, c1: 3, r2: 9, c2: 5 }, (i) => rows[i], 'uk', label);
    const m = parseTsv(c.text);
    expect(m).toHaveLength(10);
    expect(m.every((r) => r.length === 3)).toBe(true);
    expect(c.raw[0]!.map((x) => x.field)).toEqual(['price', 'oldPrice', 'stock']);
    expect(m[0]![2]).toBe(String(rows[0]!.stock));
  });
  it('typed values are kept alongside the text (lossless in-app paste)', () => {
    const c = buildCopy({ r1: 2, c1: 3, r2: 2, c2: 3 }, (i) => rows[i], 'en', label);
    expect(c.raw[0]![0]).toEqual({ field: 'price', value: rows[2]!.price });
  });
  it('select cells copy their label, empty cells copy as empty text', () => {
    const idx = rows.findIndex((r) => r.oldPrice === null);
    const c = buildCopy({ r1: idx, c1: 4, r2: idx, c2: 4 }, (i) => rows[i], 'en', label);
    expect(c.text).toBe('');
    const s = buildCopy({ r1: 0, c1: 6, r2: 0, c2: 6 }, (i) => rows[i], 'en', label);
    expect(s.text).toBe(rows[0]!.status.toUpperCase());
  });
  it('text with tabs/newlines/quotes survives a TSV round trip', () => {
    const odd = [{ ...rows[0]!, name: 'a\tb "q"\nc' }];
    const c = buildCopy({ r1: 0, c1: 1, r2: 0, c2: 1 }, (i) => odd[i], 'en', label);
    expect(parseTsv(c.text)).toEqual([['a\tb "q"\nc']]);
  });
  it('rows that vanished produce empty cells, not a crash', () => {
    expect(buildCopy({ r1: 100, c1: 1, r2: 100, c2: 1 }, () => undefined, 'en', label).text).toBe(
      '',
    );
  });
});

const asText = (_i: number, _j: number, text: string) => ({ text });
const D = { rows: 2000, cols: 9 };

describe('planPasteTargets', () => {
  it('a block lands at the top-left of the selection', () => {
    const p = planPasteTargets(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      { r1: 5, c1: 1, r2: 5, c2: 1 },
      D,
      asText,
    );
    expect(p.targets.map((t) => [t.row, t.col, (t.input as { text: string }).text])).toEqual([
      [5, 1, 'a'],
      [5, 2, 'b'],
      [6, 1, 'c'],
      [6, 2, 'd'],
    ]);
    expect(p.area).toEqual({ r1: 5, c1: 1, r2: 6, c2: 2 });
  });
  it('ONE value is pasted into EVERY selected cell', () => {
    const p = planPasteTargets([['x']], { r1: 2, c1: 1, r2: 4, c2: 2 }, D, asText);
    expect(p.targets).toHaveLength(6);
    expect(new Set(p.targets.map((t) => (t.input as { text: string }).text))).toEqual(
      new Set(['x']),
    );
  });
  it('one value, one cell selected: just that cell', () => {
    expect(
      planPasteTargets([['x']], { r1: 2, c1: 1, r2: 2, c2: 1 }, D, asText).targets,
    ).toHaveLength(1);
  });
  it('a block bigger than the room is cut off at the grid edge and the cut is counted', () => {
    const p = planPasteTargets(
      Array.from({ length: 5 }, () => ['a', 'b', 'c']),
      { r1: 1998, c1: 7, r2: 1998, c2: 7 },
      D,
      asText,
    );
    expect(p.targets).toHaveLength(2 * 2);
    expect(p.clipped).toBe(15 - 4);
  });
  it('ragged rows (Excel trims trailing blanks) are fine', () => {
    const p = planPasteTargets([['a', 'b', 'c'], ['d']], { r1: 0, c1: 0, r2: 0, c2: 0 }, D, asText);
    expect(p.targets.length).toBe(6); // missing cells paste as empty text
    expect((p.targets[4]!.input as { text: string }).text).toBe('');
  });
  it('nothing to paste -> nothing', () => {
    expect(planPasteTargets([], { r1: 0, c1: 0, r2: 0, c2: 0 }, D, asText).targets).toEqual([]);
    expect(
      planPasteTargets([['x']], { r1: 0, c1: 0, r2: 0, c2: 0 }, { rows: 0, cols: 9 }, asText)
        .targets,
    ).toEqual([]);
  });
  it('500 rows x 1 column pastes quickly', () => {
    const t0 = performance.now();
    const p = planPasteTargets(
      Array.from({ length: 500 }, (_, i) => [String(i)]),
      { r1: 0, c1: 5, r2: 0, c2: 5 },
      D,
      asText,
    );
    expect(p.targets).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(1000); // sanity ceiling against O(n^2), not a benchmark (CPU is shared)
  });
});
