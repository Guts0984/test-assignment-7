export type CellPos = { row: number; col: number };
/** Inclusive, normalised: r1 <= r2 and c1 <= c2. */
export type CellRange = { r1: number; c1: number; r2: number; c2: number };
export type GridDims = { rows: number; cols: number };

/**
 * Excel-style selection. `anchor` is where the range started, `focus` is the moving corner,
 * `active` is the cell that receives typing (usually the anchor; Ctrl+A keeps it where it was).
 */
export type Selection = { active: CellPos; anchor: CellPos; focus: CellPos };

export const samePos = (a: CellPos, b: CellPos): boolean => a.row === b.row && a.col === b.col;
