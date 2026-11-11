import type { EditableField, ProductRow } from '@catalog/shared';
import { COLUMNS, displayText, type CellInput, type CellTarget } from '@/entities/product';
import type { CellRange, GridDims } from '@/shared/lib/grid';
import { serializeTsv } from '@/shared/lib/grid';
import type { AppLocale } from '@/shared/lib/locale';

export type RawCell = { field: EditableField; value: unknown };
/** What a copy leaves behind: the text for the system clipboard and the typed values for a lossless in-app paste. */
export type CopyPayload = { text: string; raw: RawCell[][] };

/** Selected range -> TSV (localised, what a spreadsheet would show) + the typed values. */
export const buildCopy = (
  range: CellRange,
  rowAt: (i: number) => ProductRow | undefined,
  locale: AppLocale,
  label: (field: 'category' | 'status', value: string) => string,
): CopyPayload => {
  const text: string[][] = [];
  const raw: RawCell[][] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    const row = rowAt(r);
    const t: string[] = [];
    const v: RawCell[] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const field = COLUMNS[c]!.field;
      const value = row ? row[field] : null;
      v.push({ field, value });
      t.push(
        value === null || value === undefined
          ? ''
          : field === 'category' || field === 'status'
            ? label(field, String(value))
            : displayText(field, value, locale),
      );
    }
    text.push(t);
    raw.push(v);
  }
  return { text: serializeTsv(text), raw };
};

export type PasteTarget = { targets: CellTarget[]; clipped: number; area: CellRange | null };

/**
 * Clipboard matrix + selection -> cells to fill.
 *  - one value, many cells selected: the value goes into every selected cell (like Excel)
 *  - otherwise the block lands at the top-left of the selection and is cut off at the grid edge
 * `toInput` decides, per cell, whether to use the typed value (same kind of column) or parse the text.
 */
export const planPasteTargets = (
  matrix: readonly (readonly string[])[],
  selection: CellRange,
  dims: GridDims,
  toInput: (i: number, j: number, text: string, targetCol: number) => CellInput,
): PasteTarget => {
  const h = matrix.length;
  const w = Math.max(0, ...matrix.map((r) => r.length));
  if (h === 0 || w === 0 || dims.rows === 0) return { targets: [], clipped: 0, area: null };

  const targets: CellTarget[] = [];
  const multi = selection.r1 !== selection.r2 || selection.c1 !== selection.c2;
  if (h === 1 && w === 1 && multi) {
    const text = matrix[0]![0] ?? '';
    for (let r = selection.r1; r <= selection.r2; r++) {
      for (let c = selection.c1; c <= selection.c2; c++)
        targets.push({ row: r, col: c, input: toInput(0, 0, text, c) });
    }
    return { targets, clipped: 0, area: selection };
  }

  let clipped = 0;
  let maxR = selection.r1;
  let maxC = selection.c1;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const row = selection.r1 + i;
      const col = selection.c1 + j;
      if (row >= dims.rows || col >= dims.cols) {
        clipped++;
        continue;
      }
      targets.push({ row, col, input: toInput(i, j, matrix[i]?.[j] ?? '', col) });
      maxR = Math.max(maxR, row);
      maxC = Math.max(maxC, col);
    }
  }
  return { targets, clipped, area: { r1: selection.r1, c1: selection.c1, r2: maxR, c2: maxC } };
};
