import { SETTABLE_BULK_FIELDS, type BulkOperation, type EditableField } from '@catalog/shared';
import { COLUMN_BY_FIELD, parseCellInput } from '@/entities/product';
import { parseDecimal, parseInteger, type AppLocale } from '@/shared/lib/locale';

export type OperationKind = 'set' | 'percent' | 'absolute' | 'addTag' | 'removeTag';
export type OperationDraft = { kind: OperationKind; field: EditableField; text: string };

export const NUMBER_FIELDS = ['price', 'oldPrice', 'stock'] as const;
export const SET_FIELDS = SETTABLE_BULK_FIELDS;

export type Built = { ok: true; operation: BulkOperation } | { ok: false; error: string };

/**
 * What the person filled in -> the operation the API takes, by locale ("10,5" in uk, "10.5" in en).
 * Everything the API would reject (bad number, wrong field, non-integer stock change) is caught here.
 */
export const buildOperation = (d: OperationDraft, locale: AppLocale): Built => {
  const text = d.text.trim();
  if (d.kind === 'addTag' || d.kind === 'removeTag') {
    if (text === '') return { ok: false, error: 'required' };
    if (text.length > 50) return { ok: false, error: 'tagTooLong' };
    return { ok: true, operation: { type: d.kind, tag: text } };
  }
  if (d.kind === 'set') {
    if (!(SET_FIELDS as readonly string[]).includes(d.field))
      return { ok: false, error: 'invalid' };
    const parsed = parseCellInput(d.field, d.text, locale);
    if (!parsed.ok) return { ok: false, error: parsed.error.code };
    return {
      ok: true,
      operation: {
        type: 'set',
        field: d.field as (typeof SET_FIELDS)[number],
        value: parsed.value,
      },
    };
  }
  // percent / absolute change of a number
  if (!(NUMBER_FIELDS as readonly string[]).includes(d.field))
    return { ok: false, error: 'invalid' };
  const field = d.field as (typeof NUMBER_FIELDS)[number];
  const kind = COLUMN_BY_FIELD[field].kind;
  if (text === '') return { ok: false, error: 'required' };
  const r =
    kind === 'integer' && d.kind === 'absolute'
      ? parseInteger(text, locale, { allowNegative: true })
      : parseDecimal(text, locale, { allowNegative: true });
  if (!r.ok) return { ok: false, error: 'notNumber' };
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(r.value))
    return { ok: false, error: r.value.includes('.') ? 'tooManyDecimals' : 'tooLarge' };
  if (d.kind === 'percent' && Number(r.value) <= -100) return { ok: false, error: 'percentTooLow' };
  return { ok: true, operation: { type: 'adjust', field, mode: d.kind, amount: r.value } };
};
