import { describe, expect, it } from 'vitest';
import type { ProductRow } from '@catalog/shared';
import { makeProducts } from '@/shared/api/mocks/data';
import { planCellValues } from './plan-cells';

const products = makeProducts(60);
const admin = { role: 'admin' as const, categories: [] as string[] };
const viewer = { role: 'viewer' as const, categories: [] as string[] };
const editor = { role: 'editor' as const, categories: ['electronics', 'computers'] };
const ctx = (
  me: { role: 'admin' | 'editor' | 'viewer'; categories: string[] } = admin,
  locale: 'uk' | 'en' = 'en',
  rows: ProductRow[] = products,
) => ({
  rowAt: (i: number) => rows[i],
  me,
  locale,
});
const STOCK = 5;
const NAME = 1;
const PRICE = 3;
const OLD = 4;
const STATUS = 6;

describe('planCellValues', () => {
  it('parses text by locale and returns edits only for changed cells', () => {
    const p = planCellValues(
      [
        { row: 0, col: STOCK, input: { text: '1 234' } },
        { row: 1, col: STOCK, input: { text: String(products[1]!.stock) } }, // unchanged
      ],
      ctx(admin, 'uk'),
    );
    expect(p.edits).toEqual([{ id: products[0]!.id, field: 'stock', value: 1234 }]);
    expect(p).toMatchObject({ applied: 1, unchanged: 1, invalid: 0, skippedReadOnly: 0 });
  });

  it('typed values (from the in-app clipboard) are checked with the shared schema', () => {
    const p = planCellValues(
      [
        { row: 0, col: STOCK, input: { value: 7 } },
        { row: 1, col: STOCK, input: { value: -5 } },
        { row: 2, col: STOCK, input: { value: '7' } },
      ],
      ctx(),
    );
    expect(p.applied).toBe(1);
    expect(p.invalid).toBe(2);
    expect(Object.keys(p.errors)).toHaveLength(2);
  });

  it('viewer: everything is skipped as read-only, nothing is produced', () => {
    const p = planCellValues(
      Array.from({ length: 10 }, (_, i) => ({ row: i, col: STOCK, input: { text: '1' } })),
      ctx(viewer),
    );
    expect(p).toMatchObject({ applied: 0, skippedReadOnly: 10 });
    expect(p.edits).toEqual([]);
  });

  it('editor: foreign-category rows are skipped, own rows edited, no foreign category can be set', () => {
    const own = products.findIndex((r) => r.category && editor.categories.includes(r.category));
    const foreign = products.findIndex(
      (r) => r.category && !editor.categories.includes(r.category),
    );
    const p = planCellValues(
      [
        { row: own, col: STOCK, input: { text: '9999' } },
        { row: foreign, col: STOCK, input: { text: '9999' } },
      ],
      ctx(editor),
    );
    expect(p.edits.map((e) => e.id)).toEqual([products[own]!.id]);
    expect(p.skippedReadOnly).toBe(1);
    const toForeign = planCellValues([{ row: own, col: 2, input: { text: 'toys' } }], ctx(editor));
    expect(toForeign.edits).toEqual([]);
    expect(Object.values(toForeign.errors)[0]!.code).toBe('categoryForbidden');
  });

  it('cross-field: a product whose combined edits break a rule is refused as a whole and every cell explains why', () => {
    const idx = products.findIndex(
      (r) => r.price !== null && r.oldPrice === null && r.status === 'active',
    );
    const p = planCellValues(
      [
        { row: idx, col: NAME, input: { text: 'Fine name' } },
        { row: idx, col: OLD, input: { text: products[idx]!.price! } }, // oldPrice == price: invalid
      ],
      ctx(),
    );
    expect(p.edits).toEqual([]);
    expect(p.invalid).toBe(2);
    expect(Object.values(p.errors).every((e) => e.code === 'oldPriceNotGreater')).toBe(true);
  });

  it('cross-field is judged on the FINAL state: price and oldPrice moved together are fine', () => {
    const idx = products.findIndex((r) => r.price !== null && r.oldPrice !== null);
    const p = planCellValues(
      [
        { row: idx, col: PRICE, input: { text: '900.00' } },
        { row: idx, col: OLD, input: { text: '950.00' } },
      ],
      ctx(),
    );
    expect(p.applied).toBe(2);
  });

  it('one bad product does not stop the others', () => {
    const bad = products.findIndex((r) => r.status === 'draft' && r.price === null);
    const p = planCellValues(
      [
        { row: bad, col: STATUS, input: { text: 'active' } }, // draft without price -> invalid
        {
          row: bad + 1 === products.length ? 0 : bad === 0 ? 1 : 0,
          col: STOCK,
          input: { text: '3' },
        },
      ],
      ctx(),
    );
    expect(p.invalid).toBe(1);
    expect(p.applied).toBe(1);
  });

  it('empty text clears nullable cells (price -> null) and is rejected for required ones (stock)', () => {
    const idx = products.findIndex(
      (r) => r.price !== null && r.status !== 'active' && r.oldPrice === null,
    );
    const p = planCellValues(
      [
        { row: idx, col: PRICE, input: { text: '' } },
        { row: idx, col: STOCK, input: { text: '' } },
      ],
      ctx(),
    );
    expect(p.edits).toEqual([{ id: products[idx]!.id, field: 'price', value: null }]);
    expect(p.invalid).toBe(1);
  });

  it('rows that no longer exist (list shrank) are ignored', () => {
    const p = planCellValues([{ row: 9999, col: STOCK, input: { text: '1' } }], ctx());
    expect(p).toMatchObject({ applied: 0, invalid: 0, skippedReadOnly: 0 });
  });

  it('500 targets plan quickly', () => {
    const big = makeProducts(600);
    const t0 = performance.now();
    const p = planCellValues(
      big.slice(0, 500).map((_, i) => ({ row: i, col: STOCK, input: { text: String(1000 + i) } })),
      ctx(admin, 'en', big),
    );
    expect(p.applied).toBe(500);
    expect(performance.now() - t0).toBeLessThan(1000); // sanity ceiling against O(n^2), not a benchmark (CPU is shared)
  });
});
