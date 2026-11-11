export type VirtualWindow = {
  /** First and last (inclusive) row index to render, or start > end when there is nothing to render. */
  start: number;
  end: number;
  /** Pixel offset of row `start` from the top of the scroll content. */
  offsetTop: number;
  totalHeight: number;
};

/**
 * Which rows are visible. Pure arithmetic on a fixed row height: O(1) however many rows exist,
 * so scrolling 2000 (or 200 000) rows only ever mounts a screenful.
 */
export const computeWindow = (p: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  overscan?: number;
}): VirtualWindow => {
  const { rowHeight, rowCount } = p;
  const overscan = p.overscan ?? 5;
  const totalHeight = rowCount * rowHeight;
  if (rowCount <= 0 || rowHeight <= 0 || p.viewportHeight <= 0) {
    return { start: 0, end: -1, offsetTop: 0, totalHeight: Math.max(0, totalHeight) };
  }
  const maxScroll = Math.max(0, totalHeight - p.viewportHeight);
  const scrollTop = Math.min(Math.max(0, p.scrollTop), maxScroll);
  const first = Math.floor(scrollTop / rowHeight);
  const last = Math.ceil((scrollTop + p.viewportHeight) / rowHeight) - 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount - 1, last + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight };
};

/** Rows to mount: the window plus rows that must stay in the DOM (the focused cell keeps its tabindex target). */
export const rowsToMount = (
  w: VirtualWindow,
  keep: readonly number[],
  rowCount: number,
): number[] => {
  const out: number[] = [];
  for (let i = w.start; i <= w.end; i++) out.push(i);
  for (const k of keep) if (k >= 0 && k < rowCount && (k < w.start || k > w.end)) out.push(k);
  return out.sort((a, b) => a - b);
};

/** scrollTop that brings `row` fully into view (or the current one if it already is). */
export const scrollTopToReveal = (p: {
  row: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  /** Height of a sticky header covering the top of the viewport. */
  headerHeight?: number;
}): number => {
  const header = p.headerHeight ?? 0;
  const top = p.row * p.rowHeight;
  const bottom = top + p.rowHeight;
  const visibleTop = p.scrollTop;
  const visibleBottom = p.scrollTop + p.viewportHeight - header;
  if (top < visibleTop) return top;
  if (bottom > visibleBottom) return bottom - (p.viewportHeight - header);
  return p.scrollTop;
};
