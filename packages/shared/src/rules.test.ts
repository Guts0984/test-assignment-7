import { describe, expect, it } from 'vitest';
import { validateFieldValue, validateProductState } from './rules';
import { isoDate } from './product';
import { canEditCategory } from './auth';
import { CATEGORIES, type Category } from './categories';

const state = (o: Partial<Parameters<typeof validateProductState>[0]> = {}) => ({
  price: '10.00',
  oldPrice: null,
  status: 'draft' as const,
  category: 'books' as Category | null,
  ...o,
});

describe('cross-field rules', () => {
  it('oldPrice must be strictly greater than price', () => {
    expect(validateProductState(state({ oldPrice: '10.00' }))[0]?.code).toBe('oldPriceNotGreater');
    expect(validateProductState(state({ oldPrice: '9.99' }))[0]?.code).toBe('oldPriceNotGreater');
    expect(validateProductState(state({ oldPrice: '10.01' }))).toEqual([]);
  });
  it('compares "9.5" vs "10" numerically, not lexically', () => {
    expect(validateProductState(state({ price: '9.50', oldPrice: '10.00' }))).toEqual([]);
  });
  it('oldPrice without price is an error', () => {
    expect(validateProductState(state({ price: null, oldPrice: '5.00' }))[0]?.code).toBe(
      'oldPriceRequiresPrice',
    );
  });
  it('active requires price and category (reports both)', () => {
    const codes = validateProductState(
      state({ status: 'active', price: null, category: null }),
    ).map((i) => i.code);
    expect(codes).toEqual(['activeRequiresPrice', 'activeRequiresCategory']);
  });
  it('draft/archived may lack price and category', () => {
    expect(
      validateProductState(state({ status: 'archived', price: null, category: null })),
    ).toEqual([]);
  });
});

describe('field values', () => {
  it.each([
    ['price', '0'],
    ['price', '0.00'],
    ['price', '-1'],
    ['price', 10], // number, not string: precision rule
    ['price', '1e3'], // must be rejected, not crash BigInt()
    ['price', '0x10'],
    ['price', ' 5'],
    ['price', '1.001'],
    ['stock', -1],
    ['stock', 1.5],
    ['stock', '5'],
    ['stock', Number.NaN],
    ['stock', 2 ** 31],
    ['name', ''],
    ['name', '   '],
    ['name', 'x'.repeat(201)],
    ['status', 'ACTIVE'],
    ['category', 'nope'],
    ['tags', ['a', 'a']],
    ['tags', [' ']],
    ['tags', 'a,b'],
    ['arrivalDate', '2024-02-30'],
    ['arrivalDate', '2024-13-01'],
    ['arrivalDate', '2024-1-1'],
    ['arrivalDate', '2024-01-01T00:00:00Z'],
    ['sku', ''],
    ['sku', 'a b'],
    ['sku', "x'; DROP TABLE products;--"],
  ] as const)('rejects %s = %j', (f, v) => {
    expect(validateFieldValue(f, v).length).toBeGreaterThan(0);
  });
  it.each([
    ['price', '0.01'],
    ['price', '999999999999.99'],
    ['oldPrice', null],
    ['category', null],
    ['arrivalDate', '2024-02-29'],
    ['stock', 0],
    ['tags', []],
  ] as const)('accepts %s = %j', (f, v) => {
    expect(validateFieldValue(f, v)).toEqual([]);
  });
  it('name allows exactly 200 chars', () => {
    expect(validateFieldValue('name', 'x'.repeat(200))).toEqual([]);
  });
  it('rejects non-nullable null', () => {
    expect(validateFieldValue('name', null).length).toBe(1);
    expect(validateFieldValue('stock', null).length).toBe(1);
  });
  it('leap-year handling', () => {
    expect(isoDate('2023-02-29')).toBe(false);
    expect(isoDate('2000-02-29')).toBe(true);
    expect(isoDate('1900-02-29')).toBe(false);
  });
});

describe('canEditCategory', () => {
  it('admin edits all, viewer nothing, editor only own', () => {
    expect(canEditCategory({ role: 'admin', categories: [] }, 'books')).toBe(true);
    expect(canEditCategory({ role: 'viewer', categories: ['books'] }, 'books')).toBe(false);
    expect(canEditCategory({ role: 'editor', categories: ['books'] }, 'books')).toBe(true);
    expect(canEditCategory({ role: 'editor', categories: ['books'] }, 'toys')).toBe(false);
  });
  it('editor cannot touch products without a category', () => {
    expect(canEditCategory({ role: 'editor', categories: ['books'] }, null)).toBe(false);
  });
  it('has exactly 20 unique categories', () => {
    expect(new Set(CATEGORIES).size).toBe(20);
  });
});
