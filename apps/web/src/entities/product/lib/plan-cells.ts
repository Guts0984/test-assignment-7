import {
  fieldValueSchemas,
  normalizeDecimal,
  type EditableField,
  type Me,
  type ProductRow,
} from '@catalog/shared';
import type { AppLocale } from '@/shared/lib/locale';
import { COLUMNS, COLUMN_BY_FIELD } from '../model/columns';
import { canEditRow, canSetCategory } from '../model/permissions';
import { cellKey, type CellEdit } from '../model/types';
import { crossFieldErrors, parseCellInput, type CellError } from './cell-input';

/** A value to put into a cell: either text (typed/pasted, parsed by locale) or an already typed value. */
export type CellInput = { text: string } | { value: unknown };
export type CellTarget = { row: number; col: number; input: CellInput };

export type CellPlan = {
  /** Valid edits, ready for the queue. */
  edits: CellEdit[];
  /** Cells to highlight, keyed `${id}:${field}`. */
  errors: Record<string, CellError>;
  applied: number;
  unchanged: number;
  skippedReadOnly: number;
  invalid: number;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Turns "put these values into these cells" (a paste, a fill, a clear) into edits that are safe to send:
 *  - read-only rows are skipped (counted)
 *  - text is parsed by locale; typed values are checked with the shared schema (the API's own rules)
 *  - an editor cannot move a product into a category they do not edit
 *  - cross-field rules are checked per product on the state AFTER all its edits; one broken edit
 *    rejects that product's edits together (the API is atomic per product too)
 *  - values equal to the current ones are dropped
 */
export const planCellValues = (
  targets: readonly CellTarget[],
  ctx: {
    rowAt: (index: number) => ProductRow | undefined;
    me: Pick<Me, 'role' | 'categories'>;
    locale: AppLocale;
  },
): CellPlan => {
  const plan: CellPlan = {
    edits: [],
    errors: {},
    applied: 0,
    unchanged: 0,
    skippedReadOnly: 0,
    invalid: 0,
  };
  const byRow = new Map<
    string,
    { row: ProductRow; edits: CellEdit[]; positions: EditableField[] }
  >();

  for (const t of targets) {
    const row = ctx.rowAt(t.row);
    const col = COLUMNS[t.col];
    if (!row || !col) continue;
    const field = col.field;
    if (!canEditRow(ctx.me, row)) {
      plan.skippedReadOnly++;
      continue;
    }
    let value: unknown;
    if ('text' in t.input) {
      const parsed = parseCellInput(field, t.input.text, ctx.locale);
      if (!parsed.ok) {
        plan.errors[cellKey(row.id, field)] = parsed.error;
        plan.invalid++;
        continue;
      }
      value = parsed.value;
    } else {
      value = t.input.value;
      if (COLUMN_BY_FIELD[field].kind === 'decimal' && typeof value === 'string')
        value = normalizeDecimal(value) ?? value;
      if (!fieldValueSchemas[field].safeParse(value).success) {
        plan.errors[cellKey(row.id, field)] = { code: 'invalid', field };
        plan.invalid++;
        continue;
      }
    }
    if (field === 'category' && !canSetCategory(ctx.me, value as string | null)) {
      plan.errors[cellKey(row.id, field)] = { code: 'categoryForbidden', field };
      plan.invalid++;
      continue;
    }
    if (same(value, row[field])) {
      plan.unchanged++;
      continue;
    }
    const g = byRow.get(row.id) ?? { row, edits: [], positions: [] };
    // Pasting the same cell twice (overlapping fill) keeps the last value.
    const existing = g.edits.findIndex((e) => e.field === field);
    if (existing >= 0) g.edits[existing] = { id: row.id, field, value };
    else {
      g.edits.push({ id: row.id, field, value });
      g.positions.push(field);
    }
    byRow.set(row.id, g);
  }

  for (const { row, edits } of byRow.values()) {
    const cross = crossFieldErrors(row, edits);
    if (cross.length) {
      for (const e of cross) plan.errors[cellKey(row.id, e.field)] = e;
      // also mark the edited cells, so the person sees why the whole row was refused
      for (const e of edits) plan.errors[cellKey(row.id, e.field)] ??= cross[0]!;
      plan.invalid += edits.length;
      continue;
    }
    plan.edits.push(...edits);
    plan.applied += edits.length;
  }
  return plan;
};
