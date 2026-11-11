import { rangeContains, selectionRange, type Selection } from '@/shared/lib/grid';

/** Bit flags describing how a cell looks; a plain number so Zustand's equality check keeps unaffected cells quiet. */
export const V = {
  InRange: 1,
  Active: 2,
  EdgeTop: 4,
  EdgeBottom: 8,
  EdgeLeft: 16,
  EdgeRight: 32,
  MultiRange: 64,
} as const;

export const cellVisual = (sel: Selection | null, row: number, col: number): number => {
  if (!sel) return 0;
  const r = selectionRange(sel);
  if (!rangeContains(r, row, col)) return 0;
  let v: number = V.InRange;
  if (sel.active.row === row && sel.active.col === col) v |= V.Active;
  if (row === r.r1) v |= V.EdgeTop;
  if (row === r.r2) v |= V.EdgeBottom;
  if (col === r.c1) v |= V.EdgeLeft;
  if (col === r.c2) v |= V.EdgeRight;
  if (r.r1 !== r.r2 || r.c1 !== r.c2) v |= V.MultiRange;
  return v;
};
