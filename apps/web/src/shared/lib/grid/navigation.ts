import { clampPos, isSingleCell, selectionRange } from './range';
import { samePos, type CellPos, type GridDims, type Selection } from './types';

export const single = (p: CellPos): Selection => ({ active: p, anchor: p, focus: p });

export type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, CellPos> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

/** Arrow keys. Plain: moves the active cell and collapses. Shift: moves only the focus corner. */
export const arrow = (s: Selection, d: GridDims, dir: Dir, extend: boolean): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const { row, col } = DELTA[dir];
  if (extend) {
    return { ...s, focus: clampPos({ row: s.focus.row + row, col: s.focus.col + col }, d) };
  }
  return single(clampPos({ row: s.active.row + row, col: s.active.col + col }, d));
};

/** Ctrl/Cmd + arrow: jump to the edge of the grid. */
export const arrowToEdge = (s: Selection, d: GridDims, dir: Dir, extend: boolean): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const from = extend ? s.focus : s.active;
  const to: CellPos = {
    up: { row: 0, col: from.col },
    down: { row: d.rows - 1, col: from.col },
    left: { row: from.row, col: 0 },
    right: { row: from.row, col: d.cols - 1 },
  }[dir];
  return extend ? { ...s, focus: to } : single(to);
};

export const home = (s: Selection, d: GridDims, ctrl: boolean, extend: boolean): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const from = extend ? s.focus : s.active;
  const to = ctrl ? { row: 0, col: 0 } : { row: from.row, col: 0 };
  return extend ? { ...s, focus: to } : single(to);
};

export const end = (s: Selection, d: GridDims, ctrl: boolean, extend: boolean): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const from = extend ? s.focus : s.active;
  const to = ctrl ? { row: d.rows - 1, col: d.cols - 1 } : { row: from.row, col: d.cols - 1 };
  return extend ? { ...s, focus: to } : single(to);
};

export const page = (
  s: Selection,
  d: GridDims,
  pageRows: number,
  dir: 'up' | 'down',
  extend: boolean,
): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const step = Math.max(1, pageRows) * (dir === 'down' ? 1 : -1);
  const from = extend ? s.focus : s.active;
  const to = clampPos({ row: from.row + step, col: from.col }, d);
  return extend ? { ...s, focus: to } : single(to);
};

/** Ctrl+A: everything, keeping the active cell where it is. */
export const selectAll = (s: Selection, d: GridDims): Selection =>
  d.rows === 0 || d.cols === 0
    ? s
    : { active: s.active, anchor: { row: 0, col: 0 }, focus: { row: d.rows - 1, col: d.cols - 1 } };

/**
 * Enter / Tab. With a single cell selected they move (and collapse). With a range selected they walk
 * the active cell *inside* the range, wrapping like Excel, and keep the range.
 */
export const advance = (s: Selection, d: GridDims, dir: Dir): Selection => {
  if (d.rows === 0 || d.cols === 0) return s;
  const r = selectionRange(s);
  if (isSingleCell(r))
    return single(
      clampPos({ row: s.active.row + DELTA[dir].row, col: s.active.col + DELTA[dir].col }, d),
    );

  let { row, col } = s.active;
  if (dir === 'down' || dir === 'up') {
    row += dir === 'down' ? 1 : -1;
    if (row > r.r2) [row, col] = [r.r1, col + 1 > r.c2 ? r.c1 : col + 1];
    else if (row < r.r1) [row, col] = [r.r2, col - 1 < r.c1 ? r.c2 : col - 1];
  } else {
    col += dir === 'right' ? 1 : -1;
    if (col > r.c2) [col, row] = [r.c1, row + 1 > r.r2 ? r.r1 : row + 1];
    else if (col < r.c1) [col, row] = [r.c2, row - 1 < r.r1 ? r.r2 : row - 1];
  }
  return { ...s, active: { row, col } };
};

/** Keeps a selection valid after the grid shrank (rows filtered away, data reloaded). */
export const reclamp = (s: Selection, d: GridDims): Selection | null => {
  if (d.rows === 0 || d.cols === 0) return null;
  const a = clampPos(s.active, d);
  const n = { active: a, anchor: clampPos(s.anchor, d), focus: clampPos(s.focus, d) };
  return samePos(a, s.active) && samePos(n.anchor, s.anchor) && samePos(n.focus, s.focus) ? s : n;
};
