import type { CellPos, CellRange, GridDims, Selection } from './types';

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);

export const normalizeRange = (a: CellPos, b: CellPos): CellRange => ({
  r1: Math.min(a.row, b.row),
  c1: Math.min(a.col, b.col),
  r2: Math.max(a.row, b.row),
  c2: Math.max(a.col, b.col),
});

export const selectionRange = (s: Selection): CellRange => normalizeRange(s.anchor, s.focus);

export const rangeContains = (r: CellRange, row: number, col: number): boolean =>
  row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;

export const rangeRows = (r: CellRange): number => r.r2 - r.r1 + 1;
export const rangeCols = (r: CellRange): number => r.c2 - r.c1 + 1;
export const rangeSize = (r: CellRange): number => rangeRows(r) * rangeCols(r);
export const isSingleCell = (r: CellRange): boolean => r.r1 === r.r2 && r.c1 === r.c2;

export const clampPos = (p: CellPos, d: GridDims): CellPos => ({
  row: clamp(p.row, 0, Math.max(0, d.rows - 1)),
  col: clamp(p.col, 0, Math.max(0, d.cols - 1)),
});

export const clampRange = (r: CellRange, d: GridDims): CellRange => ({
  r1: clamp(r.r1, 0, Math.max(0, d.rows - 1)),
  r2: clamp(r.r2, 0, Math.max(0, d.rows - 1)),
  c1: clamp(r.c1, 0, Math.max(0, d.cols - 1)),
  c2: clamp(r.c2, 0, Math.max(0, d.cols - 1)),
});

/** Visits cells row by row. */
export function* cellsIn(r: CellRange): Generator<CellPos> {
  for (let row = r.r1; row <= r.r2; row++)
    for (let col = r.c1; col <= r.c2; col++) yield { row, col };
}
