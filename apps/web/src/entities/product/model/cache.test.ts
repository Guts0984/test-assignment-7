import { describe, expect, it } from 'vitest';
import { makeProducts } from '@/shared/api/mocks/data';
import { patchRows } from './cache';

const rows = makeProducts(50);

describe('patchRows', () => {
  it('replaces only the touched row; every other row keeps its identity', () => {
    const next = patchRows(rows, [{ id: rows[3]!.id, field: 'stock', value: 999 }]);
    expect(next).not.toBe(rows);
    expect(next[3]).not.toBe(rows[3]);
    expect(next[3]!.stock).toBe(999);
    next.forEach((r, i) => {
      if (i !== 3) expect(r).toBe(rows[i]);
    });
  });
  it('does not mutate the input', () => {
    const snapshot = JSON.stringify(rows);
    patchRows(rows, [{ id: rows[0]!.id, field: 'name', value: 'x', version: 9 }]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
  it('sets value and version independently (version-only update keeps the value object)', () => {
    const next = patchRows(rows, [{ id: rows[1]!.id, field: 'price', version: 4 }]);
    expect(next[1]!.versions.price).toBe(4);
    expect(next[1]!.price).toBe(rows[1]!.price);
    expect(next[1]!.versions.name).toBe(0);
  });
  it('several patches on one row make a single new row', () => {
    const next = patchRows(rows, [
      { id: rows[2]!.id, field: 'stock', value: 1 },
      { id: rows[2]!.id, field: 'name', value: 'n', version: 1 },
    ]);
    expect(next[2]).toMatchObject({ stock: 1, name: 'n' });
    expect(next[2]!.versions.name).toBe(1);
  });
  it('a patch that changes nothing returns the SAME array (no re-render at all)', () => {
    expect(patchRows(rows, [{ id: rows[0]!.id, field: 'stock', value: rows[0]!.stock }])).toBe(
      rows,
    );
    expect(patchRows(rows, [])).toBe(rows);
    expect(patchRows(rows, [{ id: 'no-such-id', field: 'stock', value: 1 }])).toBe(rows);
  });
  it('tags compare by content, not reference', () => {
    const r = [{ ...rows[0]!, tags: ['a', 'b'] }];
    expect(patchRows(r, [{ id: r[0]!.id, field: 'tags', value: ['a', 'b'] }])).toBe(r);
    expect(patchRows(r, [{ id: r[0]!.id, field: 'tags', value: ['a'] }])).not.toBe(r);
  });
  it('is fast for a 500-row fill on 2000 rows', () => {
    const big = makeProducts(2000);
    const t0 = performance.now();
    patchRows(
      big,
      big.slice(0, 500).map((r) => ({ id: r.id, field: 'stock' as const, value: 7 })),
    );
    expect(performance.now() - t0).toBeLessThan(1000); // sanity ceiling against O(n^2), not a benchmark (CPU is shared)
  });
});
