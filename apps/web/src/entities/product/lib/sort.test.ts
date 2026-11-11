import { describe, expect, it } from 'vitest';
import type { ProductRow } from '@catalog/shared';
import { computeOrder, makeCollator } from './sort';

let n = 0;
const row = (o: Partial<ProductRow>): ProductRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  sku: `SKU-${n}`,
  name: 'n',
  category: 'books',
  price: '10.00',
  oldPrice: null,
  stock: 1,
  status: 'active',
  tags: [],
  arrivalDate: null,
  versions: {} as ProductRow['versions'],
  ...o,
});
const label = (_f: 'category' | 'status', v: string) => v;
const order = (rows: ProductRow[], q: Parameters<typeof computeOrder>[1], loc = 'en') =>
  computeOrder(rows, q, makeCollator(loc), label).map((id) => rows.find((r) => r.id === id)!);

describe('sorting', () => {
  it('prices compare as numbers, exactly (9.50 < 10.00 < 100.00; not lexical)', () => {
    const rows = [row({ price: '100.00' }), row({ price: '9.50' }), row({ price: '10.00' })];
    expect(
      order(rows, { sort: { field: 'price', dir: 'asc' }, filter: {} }).map((r) => r.price),
    ).toEqual(['9.50', '10.00', '100.00']);
    expect(
      order(rows, { sort: { field: 'price', dir: 'desc' }, filter: {} }).map((r) => r.price),
    ).toEqual(['100.00', '10.00', '9.50']);
  });
  it('empty values go last in BOTH directions', () => {
    const rows = [row({ price: null }), row({ price: '5.00' }), row({ price: '1.00' })];
    expect(
      order(rows, { sort: { field: 'price', dir: 'asc' }, filter: {} }).map((r) => r.price),
    ).toEqual(['1.00', '5.00', null]);
    expect(
      order(rows, { sort: { field: 'price', dir: 'desc' }, filter: {} }).map((r) => r.price),
    ).toEqual(['5.00', '1.00', null]);
  });
  it('text is natural and case-insensitive ("item 2" < "Item 10")', () => {
    const rows = [row({ name: 'Item 10' }), row({ name: 'item 2' }), row({ name: 'Item 1' })];
    expect(
      order(rows, { sort: { field: 'name', dir: 'asc' }, filter: {} }).map((r) => r.name),
    ).toEqual(['Item 1', 'item 2', 'Item 10']);
  });
  it('Ukrainian alphabet order (і between и and ї... not by code point)', () => {
    const rows = [
      row({ name: 'Ящик' }),
      row({ name: 'Апельсин' }),
      row({ name: 'Їжак' }),
      row({ name: 'Іграшка' }),
      row({ name: 'Жираф' }),
    ];
    const sorted = order(rows, { sort: { field: 'name', dir: 'asc' }, filter: {} }, 'uk').map(
      (r) => r.name,
    );
    expect(sorted).toEqual(['Апельсин', 'Жираф', 'Іграшка', 'Їжак', 'Ящик']);
  });
  it('dates by calendar, stock numerically, equal keys keep their original order (stable)', () => {
    const rows = [
      row({ stock: 10, arrivalDate: '2024-03-01' }),
      row({ stock: 9, arrivalDate: '2023-12-31' }),
      row({ stock: 10, arrivalDate: null }),
    ];
    expect(
      order(rows, { sort: { field: 'stock', dir: 'asc' }, filter: {} }).map((r) => r.stock),
    ).toEqual([9, 10, 10]);
    expect(order(rows, { sort: { field: 'stock', dir: 'asc' }, filter: {} })[1]).toBe(rows[0]); // stable
    expect(
      order(rows, { sort: { field: 'arrivalDate', dir: 'asc' }, filter: {} }).map(
        (r) => r.arrivalDate,
      ),
    ).toEqual(['2023-12-31', '2024-03-01', null]);
  });
  it('select columns sort by the LABEL the user reads, not the machine value', () => {
    const rows = [row({ status: 'active' }), row({ status: 'draft' }), row({ status: 'archived' })];
    const ru = (_f: 'category' | 'status', v: string) =>
      ({ active: 'В', draft: 'А', archived: 'Б' })[v] ?? v;
    const ids = computeOrder(
      rows,
      { sort: { field: 'status', dir: 'asc' }, filter: {} },
      makeCollator('uk'),
      ru,
    );
    expect(ids.map((id) => rows.find((r) => r.id === id)!.status)).toEqual([
      'draft',
      'archived',
      'active',
    ]);
  });
});

describe('filtering + sorting together', () => {
  const rows = [
    row({ name: 'Lamp', category: 'books', status: 'active', price: '10.00', stock: 5 }),
    row({ name: 'Big lamp', category: 'toys', status: 'draft', price: '50.00', stock: 0 }),
    row({ name: 'Chair', category: 'books', status: 'active', price: null, stock: 8 }),
  ];
  it('text contains, category/status lists, ranges (empty price never matches a price range)', () => {
    expect(order(rows, { sort: null, filter: { name: 'lamp' } })).toHaveLength(2);
    expect(
      order(rows, { sort: null, filter: { category: ['books'], status: ['active'] } }),
    ).toHaveLength(2);
    expect(order(rows, { sort: null, filter: { priceMin: '0' } })).toHaveLength(2);
    expect(order(rows, { sort: null, filter: { stockMin: 5, stockMax: 8 } })).toHaveLength(2);
    expect(
      order(rows, { sort: { field: 'price', dir: 'asc' }, filter: { category: ['books'] } }).map(
        (r) => r.name,
      ),
    ).toEqual(['Lamp', 'Chair']);
  });
  it('no match -> empty list, not an error', () => {
    expect(order(rows, { sort: null, filter: { name: 'zzz' } })).toEqual([]);
  });
  it('2000 rows filter+sort fast enough to run on every keystroke', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      row({ name: `Item ${i}`, price: `${(i % 997) + 1}.00`, stock: i % 50 }),
    );
    const t0 = performance.now();
    computeOrder(
      many,
      { sort: { field: 'price', dir: 'desc' }, filter: { name: 'item' } },
      makeCollator('en'),
      label,
    );
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
