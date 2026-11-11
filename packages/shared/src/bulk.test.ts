import { describe, expect, it } from 'vitest';
import { computeAdjust, divRound } from './decimal';
import { matchesFilter } from './filter';
import { createBulkJobSchema } from './bulk';
import type { ProductState } from './product';

describe('divRound', () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [4n, 2n, 2n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [-1n, 3n, 0n],
  ])('%s/%s -> %s (half away from zero)', (n, d, r) => expect(divRound(n, d)).toBe(r));
});

describe('computeAdjust', () => {
  it('+10% of 100.00 is exactly 110.00 (no float drift)', () => {
    expect(computeAdjust('price', '100.00', 'percent', '10')).toEqual({
      ok: true,
      value: '110.00',
    });
  });
  it('0.1+0.2 class: 0.10 +0.20 absolute is 0.30', () => {
    expect(computeAdjust('price', '0.10', 'absolute', '0.20')).toEqual({ ok: true, value: '0.30' });
  });
  it('rounds half up in magnitude: 0.05 +10% = 0.055 -> 0.06', () => {
    expect(computeAdjust('price', '0.05', 'percent', '10')).toEqual({ ok: true, value: '0.06' });
  });
  it('fractional percent: 19.99 * 1.075', () => {
    expect(computeAdjust('price', '19.99', 'percent', '7.5')).toEqual({ ok: true, value: '21.49' });
  });
  it('negative percent and a result that crosses zero are returned, validation rejects them later', () => {
    expect(computeAdjust('price', '10.00', 'percent', '-100')).toEqual({ ok: true, value: '0.00' });
    expect(computeAdjust('price', '10.00', 'percent', '-150')).toEqual({
      ok: true,
      value: '-5.00',
    });
  });
  it('null current is reported', () => {
    expect(computeAdjust('price', null, 'percent', '10')).toEqual({
      ok: false,
      message: 'price is empty',
    });
  });
  it('stock: percent rounds to an integer, absolute needs a whole number', () => {
    expect(computeAdjust('stock', 15, 'percent', '10')).toEqual({ ok: true, value: 17 });
    expect(computeAdjust('stock', 5, 'absolute', '-2')).toEqual({ ok: true, value: 3 });
    expect(computeAdjust('stock', 5, 'absolute', '1.5').ok).toBe(false);
  });
  it('handles the largest legal price without overflow', () => {
    expect(computeAdjust('price', '999999999999.99', 'percent', '999999999')).toMatchObject({
      ok: true,
    });
  });
});

const prod = (o: Partial<ProductState> = {}): ProductState => ({
  sku: 'SKU-00042',
  name: 'Smart Lamp',
  category: 'books',
  price: '10.00',
  oldPrice: null,
  stock: 5,
  status: 'active',
  tags: [],
  arrivalDate: null,
  ...o,
});

describe('matchesFilter', () => {
  it('text contains is case-insensitive', () => {
    expect(matchesFilter(prod(), { name: 'LAMP' })).toBe(true);
    expect(matchesFilter(prod(), { sku: 'sku-0004' })).toBe(true);
    expect(matchesFilter(prod(), { name: 'chair' })).toBe(false);
  });
  it('%, _ and quotes are literal text, not wildcards', () => {
    expect(matchesFilter(prod({ name: '100% cotton' }), { name: '100%' })).toBe(true);
    expect(matchesFilter(prod({ name: 'abc' }), { name: '%' })).toBe(false);
    expect(matchesFilter(prod({ name: 'abc' }), { name: '_' })).toBe(false);
  });
  it('ranges are inclusive and exclude empty prices', () => {
    expect(matchesFilter(prod(), { priceMin: '10.00', priceMax: '10.00' })).toBe(true);
    expect(matchesFilter(prod(), { priceMin: '10.01' })).toBe(false);
    expect(matchesFilter(prod({ price: null }), { priceMin: '0' })).toBe(false);
    expect(matchesFilter(prod({ price: null }), {})).toBe(true);
  });
  it('compares prices numerically, not as strings', () => {
    expect(matchesFilter(prod({ price: '9.50' }), { priceMax: '10' })).toBe(true);
  });
  it('category/status lists; null category never matches a category filter', () => {
    expect(matchesFilter(prod(), { category: ['books', 'toys'], status: ['active'] })).toBe(true);
    expect(matchesFilter(prod({ category: null }), { category: ['books'] })).toBe(false);
    expect(matchesFilter(prod(), { status: ['draft'] })).toBe(false);
  });
  it('stock range', () => {
    expect(matchesFilter(prod(), { stockMin: 5, stockMax: 5 })).toBe(true);
    expect(matchesFilter(prod(), { stockMax: 4 })).toBe(false);
  });
});

describe('createBulkJobSchema', () => {
  it('accepts the spec example', () => {
    const r = createBulkJobSchema.safeParse({
      filter: { category: ['books'], status: ['active'] },
      operation: { type: 'adjust', field: 'price', mode: 'percent', amount: '10' },
    });
    expect(r.success).toBe(true);
  });
  it.each([
    [{ category: ['nope'] }],
    [{ status: ['bogus'] }],
    [{ priceMin: '1e3' }],
    [{ stockMin: -1 }],
    [{ name: 'x'.repeat(201) }],
  ])('rejects bad filter %j', (filter) => {
    expect(
      createBulkJobSchema.safeParse({ filter, operation: { type: 'addTag', tag: 'a' } }).success,
    ).toBe(false);
  });
});
