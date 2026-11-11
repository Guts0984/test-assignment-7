import { describe, expect, it } from 'vitest';
import type { ProductRow } from '@catalog/shared';
import { planCellEdit } from './plan-edit';

const row = (o: Partial<ProductRow> = {}): ProductRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  sku: 'SKU-1',
  name: 'Lamp',
  category: 'books',
  price: '10.00',
  oldPrice: null,
  stock: 5,
  status: 'active',
  tags: [],
  arrivalDate: null,
  versions: {} as ProductRow['versions'],
  ...o,
});
type Who = { role: 'admin' | 'editor' | 'viewer'; categories: string[] };
const admin: Who = { role: 'admin', categories: [] };
const editor: Who = { role: 'editor', categories: ['books'] };
const viewer: Who = { role: 'viewer', categories: [] };
const plan = (
  r: ProductRow,
  field: Parameters<typeof planCellEdit>[0]['field'],
  draft: string,
  me = admin,
  locale: 'uk' | 'en' = 'en',
) => planCellEdit({ row: r, field, draft, locale, me });

describe('planCellEdit', () => {
  it('a valid change becomes one edit with the typed value', () => {
    expect(plan(row(), 'price', '12.5')).toEqual({
      ok: true,
      edits: [{ id: row().id, field: 'price', value: '12.50' }],
    });
  });
  it('Ukrainian input is understood: "1 234,5" -> 1234.50', () => {
    expect(plan(row(), 'price', '1 234,5', admin, 'uk')).toMatchObject({
      ok: true,
      edits: [{ value: '1234.50' }],
    });
  });
  it('no change -> no edit (no request, no undo step)', () => {
    expect(plan(row(), 'price', '10')).toEqual({ ok: true, edits: [] });
    expect(plan(row(), 'name', '  Lamp  ')).toEqual({ ok: true, edits: [] });
  });
  it('invalid text is an error on that cell; nothing is produced', () => {
    expect(plan(row(), 'stock', '1.5')).toEqual({
      ok: false,
      errors: [{ code: 'notInteger', field: 'stock', params: undefined }],
    });
  });
  it('cross-field problems flag the right cell, even an untouched one', () => {
    const r = row({ oldPrice: '12.00' });
    const res = plan(r, 'price', '20');
    expect(res).toEqual({ ok: false, errors: [{ code: 'oldPriceNotGreater', field: 'oldPrice' }] });
    expect(plan(row(), 'oldPrice', '10')).toMatchObject({
      ok: false,
      errors: [{ code: 'oldPriceNotGreater', field: 'oldPrice' }],
    });
  });
  it('status active without price is refused', () => {
    const r = row({ status: 'draft', price: null });
    expect(plan(r, 'status', 'active')).toMatchObject({
      ok: false,
      errors: [{ code: 'activeRequiresPrice' }],
    });
  });
  it('viewer and foreign-category editor cannot edit anything', () => {
    expect(plan(row(), 'stock', '9', viewer)).toMatchObject({
      ok: false,
      errors: [{ code: 'readOnly' }],
    });
    expect(plan(row({ category: 'toys' }), 'stock', '9', editor)).toMatchObject({
      ok: false,
      errors: [{ code: 'readOnly' }],
    });
    expect(plan(row(), 'stock', '9', editor)).toMatchObject({ ok: true });
  });
  it('an editor cannot move a product into a foreign category or clear its category', () => {
    expect(plan(row(), 'category', 'toys', editor)).toMatchObject({
      ok: false,
      errors: [{ code: 'categoryForbidden' }],
    });
    expect(plan(row(), 'category', '', editor)).toMatchObject({
      ok: false,
      errors: [{ code: 'categoryForbidden' }],
    });
    expect(plan(row(), 'category', 'toys', admin)).toMatchObject({ ok: true });
  });
});
