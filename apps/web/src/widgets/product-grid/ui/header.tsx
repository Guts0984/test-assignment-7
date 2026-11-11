'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { PointerEvent, ReactNode } from 'react';
import type { EditableField } from '@catalog/shared';
import { COLUMNS, type TableQuery } from '@/entities/product';
import { cn } from '@/shared/lib/cn';
import { useGrid } from '../model/grid-context';

export const HEADER_HEIGHT = 40;

type Props = {
  sort: TableQuery['sort'];
  onSort: (field: EditableField) => void;
  renderFilter?: (field: EditableField) => ReactNode;
};

export const GridHeader = ({ sort, onSort, renderFilter }: Props) => {
  const t = useTranslations();
  const setWidth = useGrid((s) => s.setColWidth);
  const widths = useGrid((s) => s.colWidths);

  const startResize = (e: PointerEvent<HTMLDivElement>, field: EditableField, min: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[field] ?? 100;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) =>
      setWidth(field, Math.max(min, Math.round(startW + ev.clientX - startX)));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div
      role="row"
      aria-rowindex={1}
      className="sticky top-0 z-[3] flex bg-muted"
      style={{ height: HEADER_HEIGHT, width: 'var(--w-total)' }}
    >
      {COLUMNS.map((c, i) => {
        const active = sort?.field === c.field;
        const label = t(`columns.${c.field}`);
        return (
          <div
            key={c.field}
            role="columnheader"
            aria-colindex={i + 1}
            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={cn(
              'relative flex shrink-0 items-center gap-1 border-b border-r border-border bg-muted px-2 text-sm font-semibold',
              i === 0 && 'sticky left-0 z-[4]',
            )}
            style={{ width: `var(--w-${i})`, minWidth: `var(--w-${i})` }}
          >
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1 rounded text-left hover:underline',
                c.align === 'right' && 'justify-end',
              )}
              onClick={() => onSort(c.field)}
              aria-label={t('grid.sortBy', { column: label })}
            >
              <span className="truncate">{label}</span>
              {active &&
                (sort.dir === 'asc' ? (
                  <ArrowUp aria-hidden className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
                ))}
            </button>
            {renderFilter?.(c.field)}
            {/* Resize handle: pointer drag; also operable from the keyboard with the arrow keys. */}
            {/* ARIA window splitter: a focusable separator with aria-valuenow is an interactive widget. */}
            {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- focusable separator = splitter widget */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('grid.resize', { column: label })}
              aria-valuenow={widths[c.field]}
              aria-valuemin={c.minWidth}
              aria-valuemax={600}
              tabIndex={0}
              className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ring focus-visible:bg-ring"
              onPointerDown={(e) => startResize(e, c.field, c.minWidth)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft')
                  setWidth(c.field, Math.max(c.minWidth, (widths[c.field] ?? c.width) - 10));
                if (e.key === 'ArrowRight')
                  setWidth(c.field, Math.min(600, (widths[c.field] ?? c.width) + 10));
              }}
            />
            {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          </div>
        );
      })}
    </div>
  );
};
