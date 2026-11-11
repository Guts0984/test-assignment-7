import {
  compareDecimal,
  matchesFilter,
  type EditableField,
  type ProductFilter,
  type ProductRow,
} from '@catalog/shared';
import { COLUMN_BY_FIELD } from '../model/columns';
import type { TableQuery } from './table-query';

export type Labeler = (field: 'category' | 'status', value: string) => string;

const cmpNullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // empty values go last in BOTH directions (the caller does not flip them)
  if (b === null) return -1;
  return cmp(a, b);
};

/** Natural, accent- and case-insensitive text order for the given UI locale. */
export const makeCollator = (locale: string) =>
  new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

export const compareField = (
  field: EditableField,
  a: ProductRow,
  b: ProductRow,
  collator: Intl.Collator,
  label: Labeler,
): number => {
  const kind = COLUMN_BY_FIELD[field].kind;
  const x = a[field];
  const y = b[field];
  switch (kind) {
    case 'decimal':
      return cmpNullsLast(x as string | null, y as string | null, compareDecimal);
    case 'integer':
      return (x as number) - (y as number);
    case 'date':
      return cmpNullsLast(x as string | null, y as string | null, (p, q) =>
        p < q ? -1 : p > q ? 1 : 0,
      );
    case 'tags':
      return collator.compare((x as string[]).join(' '), (y as string[]).join(' '));
    case 'select':
      return cmpNullsLast(x as string | null, y as string | null, (p, q) =>
        collator.compare(
          label(field as 'category' | 'status', p),
          label(field as 'category' | 'status', q),
        ),
      );
    default:
      return collator.compare(String(x), String(y));
  }
};

/** Ids of the rows to show, in order. Stable: ties keep the server's (sku) order. */
export const computeOrder = (
  rows: readonly ProductRow[],
  q: TableQuery,
  collator: Intl.Collator,
  label: Labeler,
): string[] => {
  const kept = hasFilter(q.filter) ? rows.filter((r) => matchesFilter(r, q.filter)) : [...rows];
  if (q.sort) {
    const { field, dir } = q.sort;
    const sign = dir === 'asc' ? 1 : -1;
    const nullable = COLUMN_BY_FIELD[field].nullable;
    kept.sort((a, b) => {
      // nulls last regardless of direction
      if (nullable) {
        const an = a[field] === null;
        const bn = b[field] === null;
        if (an !== bn) return an ? 1 : -1;
      }
      return sign * compareField(field, a, b, collator, label);
    });
  }
  return kept.map((r) => r.id);
};

const hasFilter = (f: ProductFilter): boolean => Object.keys(f).length > 0;
