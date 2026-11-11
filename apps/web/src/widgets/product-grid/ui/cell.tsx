'use client';

import { useTranslations } from 'next-intl';
import { memo } from 'react';
import type { EditableField } from '@catalog/shared';
import { COLUMN_BY_FIELD, displayText } from '@/entities/product';
import type { AppLocale } from '@/shared/lib/locale';
import { cn } from '@/shared/lib/cn';
import { CellEditor } from '@/features/edit-cell';
import { cellVisual, V } from '../model/cell-visual';
import { cellKey } from '../model/grid-store';
import { useGrid, useGridStoreApi } from '../model/grid-context';
import type { Dir } from '@/shared/lib/grid';

export const cellDomId = (gridId: string, row: number, col: number): string =>
  `${gridId}-r${row}-c${col}`;

type Props = {
  gridId: string;
  rowIndex: number;
  colIndex: number;
  rowId: string;
  field: EditableField;
  value: unknown;
  readOnly: boolean;
  locale: AppLocale;
  onCommitEdit: (move: Dir | 'none') => boolean | void;
  onCancelEdit: () => void;
};

/**
 * One cell. It is memoised on primitives and subscribes to *its own* slice of the store, so a change
 * to one cell (value, selection, error, saving) re-renders that cell and no other.
 */
export const Cell = memo(function Cell({
  gridId,
  rowIndex,
  colIndex,
  rowId,
  field,
  value,
  readOnly,
  locale,
  onCommitEdit,
  onCancelEdit,
}: Props) {
  const t = useTranslations();
  const key = cellKey(rowId, field);
  const visual = useGrid((s) => cellVisual(s.selection, rowIndex, colIndex));
  const editing = useGrid((s) =>
    s.editing && s.editing.pos.row === rowIndex && s.editing.pos.col === colIndex
      ? s.editing
      : null,
  );
  const error = useGrid((s) => s.errors[key]);
  const saving = useGrid((s) => s.saving[key] === true);
  const conflict = useGrid((s) => s.conflicts[key]);
  const isFirstTabStop = useGrid((s) => s.selection === null && rowIndex === 0 && colIndex === 0);
  const store = useGridStoreApi();
  const col = COLUMN_BY_FIELD[field];

  const isActive = (visual & V.Active) !== 0;
  const inRange = (visual & V.InRange) !== 0;
  const multi = (visual & V.MultiRange) !== 0;
  const errId = error ? `${cellDomId(gridId, rowIndex, colIndex)}-err` : undefined;

  const text = (() => {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0))
      return '';
    if (field === 'category') return t(`categories.${String(value)}`);
    if (field === 'status') return t(`status.${String(value)}`);
    return displayText(field, value, locale);
  })();

  const columnLabel = t(`columns.${field}`);
  const label = `${t('grid.cellLabel', { column: columnLabel, value: text || t('grid.emptyValue') })}${readOnly ? `, ${t('grid.readOnly')}` : ''}${saving ? `, ${t('grid.saving')}` : ''}${conflict ? `, ${t('grid.conflict')}` : ''}`;

  return (
    <div
      id={cellDomId(gridId, rowIndex, colIndex)}
      role="gridcell"
      aria-colindex={colIndex + 1}
      aria-selected={inRange}
      aria-readonly={readOnly || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={errId}
      aria-busy={saving || undefined}
      aria-label={editing ? undefined : label}
      tabIndex={isActive || isFirstTabStop ? 0 : -1}
      data-row={rowIndex}
      data-col={colIndex}
      className={cn(
        'relative flex h-full shrink-0 items-center overflow-hidden border-b border-r border-border px-2 text-sm whitespace-nowrap select-none',
        col.align === 'right' && 'justify-end tabular-nums',
        colIndex === 0 && 'sticky left-0 z-[1] bg-background',
        readOnly && 'bg-readonly text-muted-foreground',
        inRange && 'bg-selected-range',
        inRange && !isActive && multi && 'bg-selected',
        error && 'bg-danger-soft',
        conflict && 'bg-warning-soft',
        // Excel-like outline around the range, a thicker one around the active cell.
        inRange && 'shadow-[inset_0_0_0_1px_var(--ring)]',
        inRange && !(visual & V.EdgeTop) && 'shadow-none',
        isActive && 'outline-2 -outline-offset-2 outline-ring',
        error && 'outline-2 -outline-offset-2 outline-danger',
      )}
      style={{ width: `var(--w-${colIndex})`, minWidth: `var(--w-${colIndex})` }}
      onDoubleClick={() => {
        if (!readOnly)
          store
            .getState()
            .startEditing({ pos: { row: rowIndex, col: colIndex }, draft: '', origin: 'open' });
      }}
    >
      {editing ? (
        <CellEditor
          field={field}
          locale={locale}
          draft={editing.draft}
          origin={editing.origin}
          invalid={!!error}
          describedBy={errId}
          onChange={(d) => store.getState().updateDraft(d)}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : col.kind === 'tags' ? (
        <span className="flex gap-1 overflow-hidden">
          {(value as string[]).map((tag) => (
            <span key={tag} className="rounded bg-accent px-1.5 py-0.5 text-xs">
              {tag}
            </span>
          ))}
        </span>
      ) : (
        <span className="truncate">{text}</span>
      )}
      {saving && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
        />
      )}
      {conflict && (
        <span aria-hidden className="absolute right-0.5 top-0.5 text-xs text-warning">
          ⚠
        </span>
      )}
      {error && isActive && (
        <div
          id={errId}
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-0.5 max-w-64 whitespace-normal rounded border border-danger bg-popover px-2 py-1 text-xs text-danger shadow"
        >
          {t(`errors.${error.code}`, {
            example:
              field === 'arrivalDate'
                ? locale === 'uk'
                  ? '31.12.2025'
                  : '12/31/2025'
                : locale === 'uk'
                  ? '1 234,50'
                  : '1,234.50',
            ...error.params,
          })}
        </div>
      )}
    </div>
  );
});
