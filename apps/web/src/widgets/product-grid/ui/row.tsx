'use client';

import { memo } from 'react';
import type { ProductRow } from '@catalog/shared';
import { COLUMNS } from '@/entities/product';
import type { AppLocale } from '@/shared/lib/locale';
import type { Dir } from '@/shared/lib/grid';
import { Cell } from './cell';

export const ROW_HEIGHT = 36;

type Props = {
  gridId: string;
  row: ProductRow;
  index: number;
  editable: boolean;
  locale: AppLocale;
  onCommitEdit: (move: Dir | 'none') => boolean | void;
  onCancelEdit: () => void;
};

/** `row` keeps its identity unless that product changed, so unchanged rows are skipped by memo. */
export const GridRow = memo(function GridRow({
  gridId,
  row,
  index,
  editable,
  locale,
  onCommitEdit,
  onCancelEdit,
}: Props) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      className="absolute left-0 flex"
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, width: 'var(--w-total)' }}
    >
      {COLUMNS.map((c, ci) => (
        <Cell
          key={c.field}
          gridId={gridId}
          rowIndex={index}
          colIndex={ci}
          rowId={row.id}
          field={c.field}
          value={row[c.field]}
          readOnly={!editable}
          locale={locale}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
        />
      ))}
    </div>
  );
});
