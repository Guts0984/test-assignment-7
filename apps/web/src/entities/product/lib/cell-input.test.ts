import { describe, expect, it } from 'vitest';
import type { EditableField } from '@catalog/shared';
import { crossFieldErrors, displayText, editText, parseCellInput } from './cell-input';

const val = (field: EditableField, text: string, loc: 'uk' | 'en') => {
  const r = parseCellInput(field, text, loc);
  return r.ok ? r.value : `ERR:${r.error.code}`;
};

describe('parseCellInput - numbers by locale', () => {
  it.each([
    ['price', '1 234,50', 'uk', '1234.50'],
    ['price', '1,234.50', 'en', '1234.50'],
    ['price', '12,5', 'uk', '12.50'],
    ['price', '12.5', 'en', '12.50'],
    ['price', '0,01', 'uk', '0.01'],
    ['price', '999999999999,99', 'uk', '999999999999.99'],
    ['oldPrice', '', 'uk', null],
    ['price', '   ', 'en', null],
    ['stock', '1 234', 'uk', 1234],
    ['stock', '1,234', 'en', 1234],
    ['stock', '0', 'en', 0],
  ] as const)('%s %j (%s) -> %j', (field, text, loc, expected) =>
    expect(val(field, text, loc)).toEqual(expected),
  );

  it.each([
    ['price', '0', 'en', 'notPositive'],
    ['price', '0,00', 'uk', 'notPositive'],
    ['price', '-5', 'en', 'notNumber'],
    ['price', 'abc', 'en', 'notNumber'],
    ['price', '1,5', 'en', 'notNumber'], // en: comma is thousands only
    ['price', '1.234,5', 'uk', 'notNumber'],
    ['price', '1,234', 'uk', 'tooManyDecimals'],
    ['price', '1.005', 'en', 'tooManyDecimals'],
    ['price', '1' + '0'.repeat(13), 'en', 'tooLarge'],
    ['stock', '', 'en', 'required'],
    ['stock', '1,5', 'en', 'notInteger'],
    ['stock', '12,5', 'uk', 'notInteger'],
    ['stock', '-1', 'en', 'notInteger'],
    ['stock', '99999999999', 'en', 'tooLarge'],
    ['stock', 'abc', 'uk', 'notInteger'],
  ] as const)('%s %j (%s) is rejected as %s', (field, text, loc, code) =>
    expect(val(field, text, loc)).toBe(`ERR:${code}`),
  );
});

describe('parseCellInput - text, dates, selects, tags', () => {
  it('names are trimmed, required, and capped at 200', () => {
    expect(val('name', '  Lamp  ', 'en')).toBe('Lamp');
    expect(val('name', '   ', 'en')).toBe('ERR:required');
    expect(val('name', 'x'.repeat(201), 'en')).toBe('ERR:nameTooLong');
    expect(val('name', 'x'.repeat(200), 'en')).toBe('x'.repeat(200));
  });
  it('sku format is checked before it goes anywhere near the server', () => {
    expect(val('sku', 'SKU-1', 'en')).toBe('SKU-1');
    expect(val('sku', 'has space', 'en')).toBe('ERR:skuFormat');
    expect(val('sku', "x'; DROP TABLE products;--", 'en')).toBe('ERR:skuFormat');
    expect(val('sku', 'x'.repeat(65), 'en')).toBe('ERR:skuTooLong');
  });
  it('dates follow the locale; ISO always works; impossible dates are rejected', () => {
    expect(val('arrivalDate', '07.03.2024', 'uk')).toBe('2024-03-07');
    expect(val('arrivalDate', '03/07/2024', 'en')).toBe('2024-03-07');
    expect(val('arrivalDate', '2024-03-07', 'uk')).toBe('2024-03-07');
    expect(val('arrivalDate', '31.02.2024', 'uk')).toBe('ERR:notDate');
    expect(val('arrivalDate', '', 'uk')).toBe(null);
  });
  it('selects accept only listed values; category may be cleared, status may not', () => {
    expect(val('status', 'active', 'en')).toBe('active');
    expect(val('status', 'ACTIVE', 'en')).toBe('ERR:notInList');
    expect(val('status', '', 'en')).toBe('ERR:required');
    expect(val('category', '', 'en')).toBe(null);
    expect(val('category', 'books', 'en')).toBe('books');
    expect(val('category', 'nonsense', 'en')).toBe('ERR:notInList');
  });
  it('tags: comma/semicolon separated, trimmed, de-duplicated, bounded', () => {
    expect(val('tags', ' a, b ;c, a ', 'en')).toEqual(['a', 'b', 'c']);
    expect(val('tags', '', 'en')).toEqual([]);
    expect(val('tags', Array.from({ length: 21 }, (_, i) => `t${i}`).join(','), 'en')).toBe(
      'ERR:tooManyTags',
    );
    expect(val('tags', 'x'.repeat(51), 'en')).toBe('ERR:tagTooLong');
  });
});

describe('display and edit text', () => {
  it('display uses grouping/dates of the locale', () => {
    expect(displayText('price', '1234.5', 'en')).toBe('1,234.50');
    expect(displayText('price', '1234.5', 'uk').replace(/\s/gu, ' ')).toBe('1 234,50');
    expect(displayText('stock', 1234567, 'en')).toBe('1,234,567');
    expect(displayText('arrivalDate', '2024-03-07', 'uk')).toBe('07.03.2024');
    expect(displayText('tags', ['a', 'b'], 'en')).toBe('a, b');
    expect(displayText('price', null, 'en')).toBe('');
  });
  it('edit text has no grouping and uses the locale decimal mark, and parses back to the same value', () => {
    expect(editText('price', '1234.50', 'uk')).toBe('1234,50');
    expect(editText('price', '1234.50', 'en')).toBe('1234.50');
    for (const loc of ['uk', 'en'] as const) {
      for (const v of ['0.01', '10.00', '1234.50', '999999999999.99']) {
        expect(val('price', editText('price', v, loc), loc)).toBe(v);
      }
      expect(val('arrivalDate', editText('arrivalDate', '2024-03-07', loc), loc)).toBe(
        '2024-03-07',
      );
      expect(val('tags', editText('tags', ['a', 'b'], loc), loc)).toEqual(['a', 'b']);
    }
  });
});

describe('crossFieldErrors (same rules as the API, on the resulting state)', () => {
  const row = {
    price: '10.00',
    oldPrice: null,
    status: 'draft' as const,
    category: 'books' as const,
  };
  it('oldPrice must exceed price', () => {
    expect(
      crossFieldErrors(row, [{ field: 'oldPrice', value: '10.00' }]).map((e) => e.code),
    ).toEqual(['oldPriceNotGreater']);
    expect(crossFieldErrors(row, [{ field: 'oldPrice', value: '10.01' }])).toEqual([]);
  });
  it('flags the OTHER cell when an edit breaks it (price raised above an existing oldPrice)', () => {
    const r = { ...row, oldPrice: '12.00' };
    const e = crossFieldErrors(r, [{ field: 'price', value: '20.00' }]);
    expect(e).toEqual([{ code: 'oldPriceNotGreater', field: 'oldPrice' }]);
  });
  it('considers all edits together: moving both is fine', () => {
    const r = { ...row, oldPrice: '12.00' };
    expect(
      crossFieldErrors(r, [
        { field: 'price', value: '20.00' },
        { field: 'oldPrice', value: '25.00' },
      ]),
    ).toEqual([]);
  });
  it('active requires price and category', () => {
    const empty = { price: null, oldPrice: null, status: 'draft' as const, category: null };
    expect(
      crossFieldErrors(empty, [{ field: 'status', value: 'active' }])
        .map((e) => e.code)
        .sort(),
    ).toEqual(['activeRequiresCategory', 'activeRequiresPrice']);
    expect(
      crossFieldErrors(empty, [
        { field: 'status', value: 'active' },
        { field: 'price', value: '5.00' },
        { field: 'category', value: 'books' },
      ]),
    ).toEqual([]);
  });
  it('clearing the price of an active product is flagged', () => {
    const active = { ...row, status: 'active' as const };
    expect(crossFieldErrors(active, [{ field: 'price', value: null }]).map((e) => e.code)).toEqual([
      'activeRequiresPrice',
    ]);
  });
});
