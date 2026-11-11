import { describe, expect, it } from 'vitest';
import { buildOperation, type OperationDraft } from './build-operation';

const b = (d: Partial<OperationDraft>, locale: 'uk' | 'en' = 'en') =>
  buildOperation({ kind: 'percent', field: 'price', text: '', ...d }, locale);

describe('buildOperation', () => {
  it('the spec example: price +10%', () => {
    expect(b({ kind: 'percent', field: 'price', text: '10' })).toEqual({
      ok: true,
      operation: { type: 'adjust', field: 'price', mode: 'percent', amount: '10' },
    });
  });
  it('numbers are parsed by locale: uk "10,5" and "-2,5"; en "10.5"', () => {
    expect(b({ text: '10,5' }, 'uk')).toMatchObject({ ok: true, operation: { amount: '10.5' } });
    expect(b({ text: '-2,5' }, 'uk')).toMatchObject({ ok: true, operation: { amount: '-2.5' } });
    expect(b({ text: '10.5' }, 'en')).toMatchObject({ ok: true, operation: { amount: '10.5' } });
    expect(b({ text: '10,5' }, 'en')).toEqual({ ok: false, error: 'notNumber' });
  });
  it('absolute change; stock must be a whole number', () => {
    expect(b({ kind: 'absolute', field: 'price', text: '5' })).toMatchObject({
      ok: true,
      operation: { mode: 'absolute', amount: '5' },
    });
    expect(b({ kind: 'absolute', field: 'stock', text: '1.5' })).toEqual({
      ok: false,
      error: 'notNumber',
    });
    expect(b({ kind: 'absolute', field: 'stock', text: '-3' })).toMatchObject({
      ok: true,
      operation: { field: 'stock', amount: '-3' },
    });
  });
  it.each(['', '  ', 'abc', '1e3', '10.123', '12345678901'])('rejects %j', (text) => {
    expect(b({ text }).ok).toBe(false);
  });
  it('a percent of -100 or less would zero out prices: refused up front', () => {
    expect(b({ text: '-100' })).toEqual({ ok: false, error: 'percentTooLow' });
    expect(b({ text: '-99.5' }).ok).toBe(true);
  });
  it('set uses the cell parser for the field (price by locale, status from the list, date by locale)', () => {
    expect(b({ kind: 'set', field: 'price', text: '1 234,5' }, 'uk')).toEqual({
      ok: true,
      operation: { type: 'set', field: 'price', value: '1234.50' },
    });
    expect(b({ kind: 'set', field: 'status', text: 'archived' })).toMatchObject({
      ok: true,
      operation: { value: 'archived' },
    });
    expect(b({ kind: 'set', field: 'status', text: 'nope' }).ok).toBe(false);
    expect(b({ kind: 'set', field: 'arrivalDate', text: '31.12.2025' }, 'uk')).toMatchObject({
      ok: true,
      operation: { value: '2025-12-31' },
    });
  });
  it('set cannot target sku or tags (those have their own rules)', () => {
    expect(b({ kind: 'set', field: 'sku', text: 'X' }).ok).toBe(false);
    expect(b({ kind: 'set', field: 'tags', text: 'a' }).ok).toBe(false);
  });
  it('tags: trimmed, required, bounded', () => {
    expect(b({ kind: 'addTag', text: '  sale ' })).toEqual({
      ok: true,
      operation: { type: 'addTag', tag: 'sale' },
    });
    expect(b({ kind: 'removeTag', text: 'sale' })).toEqual({
      ok: true,
      operation: { type: 'removeTag', tag: 'sale' },
    });
    expect(b({ kind: 'addTag', text: '' })).toEqual({ ok: false, error: 'required' });
    expect(b({ kind: 'addTag', text: 'x'.repeat(51) })).toEqual({ ok: false, error: 'tagTooLong' });
  });
});
