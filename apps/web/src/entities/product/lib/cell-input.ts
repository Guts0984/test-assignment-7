import {
  compareDecimal,
  fieldValueSchemas,
  isDecimalString,
  normalizeDecimal,
  validateProductState,
  type EditableField,
  type ProductRow,
  type ProductState,
} from '@catalog/shared';
import {
  formatDate,
  formatDecimal,
  formatInteger,
  parseDate,
  parseDecimal,
  parseInteger,
  separators,
  type AppLocale,
} from '@/shared/lib/locale';
import { COLUMN_BY_FIELD } from '../model/columns';

/** Machine-readable reason; the UI turns it into a localised sentence (`errors.<code>`). */
export type CellError = {
  code: string;
  field: EditableField;
  params?: Record<string, string | number>;
};
export type Parsed = { ok: true; value: unknown } | { ok: false; error: CellError };

const err = (field: EditableField, code: string, params?: CellError['params']): Parsed => ({
  ok: false,
  error: { code, field, params },
});

const INT_MAX = 2_147_483_647;
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Text the person typed (or pasted) -> a typed value for the field, by locale.
 * Everything the server checks per field is checked here first, so bad values never leave the browser.
 */
export const parseCellInput = (field: EditableField, text: string, locale: AppLocale): Parsed => {
  const col = COLUMN_BY_FIELD[field];
  const trimmed = text.trim();
  switch (col.kind) {
    case 'text': {
      if (trimmed === '') return err(field, 'required');
      if (field === 'name' && trimmed.length > 200) return err(field, 'nameTooLong', { max: 200 });
      if (field === 'sku') {
        if (trimmed.length > 64) return err(field, 'skuTooLong', { max: 64 });
        if (!SKU_RE.test(trimmed)) return err(field, 'skuFormat');
      }
      return finalize(field, trimmed);
    }
    case 'decimal': {
      if (trimmed === '') return finalize(field, null);
      const r = parseDecimal(trimmed, locale);
      if (!r.ok) return err(field, 'notNumber');
      if (!isDecimalString(r.value)) {
        return err(field, /\.\d{3,}/.test(r.value) ? 'tooManyDecimals' : 'tooLarge');
      }
      if (compareDecimal(r.value, '0') <= 0) return err(field, 'notPositive');
      return finalize(field, normalizeDecimal(r.value));
    }
    case 'integer': {
      const r = parseInteger(trimmed, locale);
      if (!r.ok) return err(field, trimmed === '' ? 'required' : 'notInteger');
      const n = Number(r.value);
      if (!Number.isSafeInteger(n) || n > INT_MAX) return err(field, 'tooLarge');
      return finalize(field, n);
    }
    case 'date': {
      if (trimmed === '') return finalize(field, null);
      const r = parseDate(trimmed, locale);
      return r.ok ? finalize(field, r.value) : err(field, 'notDate');
    }
    case 'select': {
      if (trimmed === '') return col.nullable ? finalize(field, null) : err(field, 'required');
      // Accept the machine value; the editor itself offers only valid options.
      return col.options?.includes(trimmed) ? finalize(field, trimmed) : err(field, 'notInList');
    }
    case 'tags': {
      const tags = [
        ...new Set(
          trimmed
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
      if (tags.length > 20) return err(field, 'tooManyTags', { max: 20 });
      if (tags.some((t) => t.length > 50)) return err(field, 'tagTooLong', { max: 50 });
      return finalize(field, tags);
    }
  }
};

/** Last line: the shared schema (same one the API uses) must agree. */
const finalize = (field: EditableField, value: unknown): Parsed =>
  fieldValueSchemas[field].safeParse(value).success ? { ok: true, value } : err(field, 'invalid');

/** What the cell shows (grouped numbers, localised dates). Labels for selects are the caller's job. */
export const displayText = (field: EditableField, value: unknown, locale: AppLocale): string => {
  if (value === null || value === undefined) return '';
  const col = COLUMN_BY_FIELD[field];
  switch (col.kind) {
    case 'decimal':
      return formatDecimal(String(value), locale);
    case 'integer':
      return formatInteger(Number(value), locale);
    case 'date':
      return formatDate(String(value), locale);
    case 'tags':
      return (value as string[]).join(', ');
    default:
      return String(value);
  }
};

/** What the editor opens with: no grouping (easier to edit), locale decimal mark. */
export const editText = (field: EditableField, value: unknown, locale: AppLocale): string => {
  if (value === null || value === undefined) return '';
  const col = COLUMN_BY_FIELD[field];
  if (col.kind === 'decimal') return String(value).replace('.', separators(locale).decimal);
  if (col.kind === 'integer') return String(value);
  return displayText(field, value, locale);
};

type Edit = { field: EditableField; value: unknown };

/**
 * Cross-field rules on the state the product would have AFTER these edits (same function as the API).
 * Returns the cells to flag; empty means the edits are consistent.
 */
export const crossFieldErrors = (
  row: Pick<ProductRow, 'price' | 'oldPrice' | 'status' | 'category'>,
  edits: readonly Edit[],
): CellError[] => {
  const next: Pick<ProductState, 'price' | 'oldPrice' | 'status' | 'category'> = {
    price: row.price,
    oldPrice: row.oldPrice,
    status: row.status,
    category: row.category,
  };
  for (const e of edits) {
    if (
      e.field === 'price' ||
      e.field === 'oldPrice' ||
      e.field === 'status' ||
      e.field === 'category'
    ) {
      (next as Record<string, unknown>)[e.field] = e.value;
    }
  }
  return validateProductState(next).map((i) => ({ code: i.code, field: i.field }));
};
