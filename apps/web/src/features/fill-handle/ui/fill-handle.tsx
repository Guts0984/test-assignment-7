'use client';

import { useTranslations } from 'next-intl';
import type { PointerEvent } from 'react';
import type { CellRange } from '@/shared/lib/grid';

type Geometry = { left: number; top: number; width: number; height: number };

/** Pixel box of a cell range inside the scrollable grid content. */
export const rangeBox = (
  range: CellRange,
  colLeft: readonly number[],
  widths: readonly number[],
  headerHeight: number,
  rowHeight: number,
): Geometry => ({
  left: colLeft[range.c1] ?? 0,
  top: headerHeight + range.r1 * rowHeight,
  width: (colLeft[range.c2] ?? 0) + (widths[range.c2] ?? 0) - (colLeft[range.c1] ?? 0),
  height: (range.r2 - range.r1 + 1) * rowHeight,
});

/** The small square at the bottom-right corner of the selection (Excel's fill handle). */
export const FillHandle = ({
  box,
  onPointerDown,
}: {
  box: Geometry;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
}) => {
  const t = useTranslations('clipboard');
  return (
    <div
      data-fill-handle
      title={t('fillHandle')}
      aria-hidden
      onPointerDown={onPointerDown}
      className="absolute z-[6] h-2 w-2 cursor-crosshair border border-background bg-ring"
      style={{ left: box.left + box.width - 5, top: box.top + box.height - 5, touchAction: 'none' }}
    />
  );
};

/** Dashed outline of where a fill drag would end. */
export const FillPreview = ({ box }: { box: Geometry }) => (
  <div
    aria-hidden
    className="pointer-events-none absolute z-[5] border-2 border-dashed border-ring"
    style={box}
  />
);
