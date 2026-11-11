import type { EditableField, Me, ProductRow } from '@catalog/shared';
import {
  canEditRow,
  canSetCategory,
  crossFieldErrors,
  parseCellInput,
  type CellError,
} from '@/entities/product';
import type { AppLocale } from '@/shared/lib/locale';

export type CellEdit = { id: string; field: EditableField; value: unknown };
export type PlanResult = { ok: true; edits: CellEdit[] } | { ok: false; errors: CellError[] };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * One cell's draft text -> what to send, or why not. Checks, in order: may this user edit the
 * product, is the text a valid value (by locale), may they move it to that category, does it break a
 * cross-field rule. An empty `edits` array means "nothing changed" (no request, no undo step).
 */
export const planCellEdit = (p: {
  row: ProductRow;
  field: EditableField;
  draft: string;
  locale: AppLocale;
  me: Pick<Me, 'role' | 'categories'>;
}): PlanResult => {
  const { row, field, me } = p;
  if (!canEditRow(me, row)) return { ok: false, errors: [{ code: 'readOnly', field }] };
  const parsed = parseCellInput(field, p.draft, p.locale);
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };
  if (field === 'category' && !canSetCategory(me, parsed.value as string | null)) {
    return { ok: false, errors: [{ code: 'categoryForbidden', field }] };
  }
  if (same(parsed.value, row[field])) return { ok: true, edits: [] };
  const cross = crossFieldErrors(row, [{ field, value: parsed.value }]);
  if (cross.length) return { ok: false, errors: cross };
  return { ok: true, edits: [{ id: row.id, field, value: parsed.value }] };
};
