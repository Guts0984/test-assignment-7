'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Me, ProductRow } from '@catalog/shared';
import type { CellEdit, EditSource } from '@/entities/product';
import type { AppLocale } from '@/shared/lib/locale';
import { ProductGrid } from './product-grid';

/**
 * A grid wired to local state instead of a server: edits apply instantly, like the optimistic layer does.
 * Used by Storybook (interaction tests) and as a minimal example of how the grid is driven.
 */
export const GridPlayground = ({
  rows: initial,
  me,
  locale = 'en',
  height = 420,
  onCommit,
}: {
  rows: ProductRow[];
  me: Me;
  locale?: AppLocale;
  height?: number;
  onCommit?: (edits: CellEdit[], source: EditSource) => void;
}) => {
  const [rows, setRows] = useState(initial);
  const order = useMemo(() => rows.map((r) => r.id), [rows]);
  const commit = useCallback(
    (edits: CellEdit[], source: EditSource) => {
      onCommit?.(edits, source);
      setRows((cur) =>
        cur.map((r) => {
          const mine = edits.filter((e) => e.id === r.id);
          return mine.length
            ? ({ ...r, ...Object.fromEntries(mine.map((e) => [e.field, e.value])) } as ProductRow)
            : r;
        }),
      );
    },
    [onCommit],
  );
  return (
    <div style={{ height }}>
      <ProductGrid
        rows={rows}
        order={order}
        me={me}
        locale={locale}
        sort={null}
        onSort={() => {}}
        commit={commit}
        initialViewportHeight={height}
      />
    </div>
  );
};
