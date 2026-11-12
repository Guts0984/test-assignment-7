'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { matchesFilter } from '@catalog/shared';
import {
  COLUMNS,
  canEditRow,
  cellKey,
  hasActiveFilter,
  makeCollator,
  nextSort,
  patchCachedRows,
  productKeys,
  useProducts,
  EMPTY_QUERY,
  type TableQuery,
} from '@/entities/product';
import { BulkDialog } from '@/features/bulk-edit';
import { HistoryPopover } from '@/features/cell-history';
import { ConflictPopover } from '@/features/resolve-conflict';
import type { AnchorRect } from '@/shared/ui/anchored-popover';
import { useMe } from '@/entities/session';
import { ColumnFilter, useDisplayOrder, useTableQuery } from '@/features/table-query';
import { SyncIndicator, useProductEdits, type SyncOptions } from '@/features/sync-changes';
import { AppHeader } from '@/widgets/app-header';
import {
  createGridStore,
  ProductGrid,
  type GridCommand,
  type GridNotice,
} from '@/widgets/product-grid';
import { useRouter } from '@/shared/i18n/navigation';
import type { AppLocale } from '@/shared/lib/locale';
import { Button } from '@/shared/ui/button';

export const CatalogPage = ({ syncOptions }: { syncOptions?: SyncOptions }) => {
  const t = useTranslations();
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const me = useMe();
  const products = useProducts(!!me.data);
  const { query, setQuery } = useTableQuery();
  const [gridStore] = useState(() => createGridStore());
  const [notice, setNotice] = useState<string | null>(null);

  // What a paste/fill/clear did, in words, for a few seconds (polite live region).
  const announce = (n: GridNotice) => {
    const parts: string[] = [];
    if (n.applied > 0)
      parts.push(
        t(
          n.kind === 'fill'
            ? 'clipboard.filled'
            : n.kind === 'clear'
              ? 'clipboard.cleared'
              : 'clipboard.pasted',
          { count: n.applied },
        ),
      );
    else if (n.unchanged > 0 && n.invalid === 0 && n.skippedReadOnly === 0)
      parts.push(t('clipboard.unchanged', { count: n.unchanged }));
    if (n.skippedReadOnly > 0)
      parts.push(t('clipboard.skippedReadOnly', { count: n.skippedReadOnly }));
    if (n.invalid > 0) parts.push(t('clipboard.invalid', { count: n.invalid }));
    if (n.clipped > 0) parts.push(t('clipboard.clipped', { count: n.clipped }));
    setNotice(parts.length ? `${parts.join('. ')}.` : null);
  };
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8_000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (me.data === null) router.replace('/login');
  }, [me.data, router]);

  const qc = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [history, setHistory] = useState<{
    id: string;
    field: (typeof COLUMNS)[number]['field'];
    rect: AnchorRect;
  } | null>(null);
  const activeKey = useStore(gridStore, (st) => st.selection?.active ?? null);
  const conflicts = useStore(gridStore, (st) => st.conflicts);
  const errorCount = useStore(gridStore, (st) => Object.keys(st.errors).length);
  const [conflictRect, setConflictRect] = useState<AnchorRect | null>(null);
  // Hiding the popover is not resolving: the conflict stays until the person chooses.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const edits = useProductEdits(
    {
      setSaving: (p) => gridStore.getState().setSaving(p),
      setConflicts: (p) => gridStore.getState().setConflicts(p),
      setErrors: (p) => gridStore.getState().setErrors(p),
    },
    syncOptions,
  );

  const collator = useMemo(() => makeCollator(locale), [locale]);
  const label = useMemo(
    () => (field: 'category' | 'status', value: string) =>
      t(`${field === 'category' ? 'categories' : 'status'}.${value}`),
    [t],
  );
  const rows = products.data;
  const { order, staleCount, refresh } = useDisplayOrder(rows, query, locale, collator, label);

  const activeCell = (): {
    id: string;
    field: (typeof COLUMNS)[number]['field'];
    rect: AnchorRect;
  } | null => {
    const a = gridStore.getState().selection?.active;
    const id = a ? order[a.row] : undefined;
    const col = a ? COLUMNS[a.col] : undefined;
    const el = document.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
    if (!id || !col || !el) return null;
    const r = el.getBoundingClientRect();
    return {
      id,
      field: col.field,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  };
  // A bulk job changed rows on the server: send pending edits first, then reload the rows in place.
  const onBulkFinished = useCallback(async () => {
    await edits.flush();
    await qc.refetchQueries({ queryKey: productKeys.all });
    refresh();
  }, [edits, qc, refresh]);

  /** Gives focus back to the grid's active cell after a popover that held it went away (never to <body>). */
  const focusActiveCell = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')
        ?.focus({ preventScroll: true }),
    );

  const openHistory = () => setHistory(activeCell());

  const onCommand = (cmd: GridCommand) => {
    if (cmd.type === 'undo') edits.undo();
    else if (cmd.type === 'redo') edits.redo();
    else if (cmd.type === 'history') openHistory();
    else if (cmd.type === 'conflict') {
      setDismissedKey(null); // Enter on a conflicted cell brings the popover back
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-conflict-popover] button')?.focus(),
      );
    }
  };

  // The conflict popover follows the active cell when that cell is in conflict.
  const activeRowId = activeKey ? order[activeKey.row] : undefined;
  const activeField = activeKey ? COLUMNS[activeKey.col]?.field : undefined;
  const conflictKey = activeRowId && activeField ? cellKey(activeRowId, activeField) : null;
  const conflict = conflictKey ? (conflicts[conflictKey] ?? null) : null;
  // Measure the active cell after every grid change (selection, conflicts). setState happens in the
  // subscription callback, and only when the box actually moved.
  useEffect(() => {
    const measure = () =>
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
        const r = el?.getBoundingClientRect();
        const next = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
        setConflictRect((prev) =>
          prev && next && prev.left === next.left && prev.top === next.top ? prev : next,
        );
      });
    return gridStore.subscribe(measure);
  }, [gridStore]);

  if (!me.data) return null;
  const total = rows?.length ?? 0;

  return (
    <div className="flex h-screen flex-col">
      <AppHeader me={me.data} />
      <section
        aria-label={t('catalog.title')}
        className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2"
      >
        <h2 className="text-sm font-semibold">{t('catalog.title')}</h2>
        <span className="text-sm text-muted-foreground">
          {hasActiveFilter(query.filter)
            ? t('toolbar.shown', { shown: order.length, total })
            : t('toolbar.rows', { count: total })}
        </span>
        {hasActiveFilter(query.filter) && (
          <Button variant="ghost" size="sm" onClick={() => setQuery({ ...query, filter: {} })}>
            {t('toolbar.clearFilters')}
          </Button>
        )}
        {staleCount > 0 && (
          <span className="flex items-center gap-2 text-sm text-warning" role="status">
            {t('toolbar.staleRows', { count: staleCount })}
            <Button variant="outline" size="sm" onClick={refresh}>
              {t('toolbar.refreshView')}
            </Button>
          </span>
        )}
        {notice && (
          <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {notice}
          </span>
        )}
        <span className="flex-1" />
        {me.data.role !== 'viewer' && (
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            {t('bulk.open')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={openHistory} disabled={!activeKey}>
          {t('history.open')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={edits.undo}
          disabled={!edits.canUndo}
          aria-label={t('toolbar.undo')}
        >
          {t('toolbar.undo')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={edits.redo}
          disabled={!edits.canRedo}
          aria-label={t('toolbar.redo')}
        >
          {t('toolbar.redo')}
        </Button>
        <SyncIndicator
          status={edits.status}
          problems={Object.keys(conflicts).length + errorCount}
        />
      </section>
      <main id="grid" className="min-h-0 flex-1 p-2">
        {products.isPending && (
          <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
        {products.isError && (
          <p role="alert" className="p-4 text-sm text-danger">
            {t('login.unavailable')}{' '}
            <Button variant="outline" size="sm" onClick={() => products.refetch()}>
              {t('common.retry')}
            </Button>
          </p>
        )}
        {rows && (
          <div className="flex h-full min-h-0 flex-col">
            <ProductGrid
              rows={rows}
              order={order}
              me={me.data}
              locale={locale}
              sort={query.sort}
              onSort={(field) => setQuery({ ...query, sort: nextSort(query.sort, field) })}
              renderColumnFilter={(field) => (
                <ColumnFilter
                  field={field}
                  filter={query.filter}
                  locale={locale}
                  onChange={(filter) => setQuery({ ...query, filter } satisfies TableQuery)}
                />
              )}
              commit={edits.commit}
              onCommand={onCommand}
              onNotice={announce}
              store={gridStore}
            />
          </div>
        )}
      </main>
      <BulkDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        filter={query.filter}
        locale={locale}
        onFinished={onBulkFinished}
      />
      {history && rows && (
        <HistoryPopover
          rect={history.rect}
          open
          onOpenChange={(o) => !o && setHistory(null)}
          productId={history.id}
          field={history.field}
          currentVersion={rows.find((r) => r.id === history.id)?.versions[history.field] ?? 0}
          canRestore={(() => {
            const row = rows.find((r) => r.id === history.id);
            return !!row && canEditRow(me.data, row);
          })()}
          locale={locale}
          onRestored={(entry, newVersion) =>
            patchCachedRows(qc, [
              {
                id: entry.productId,
                field: entry.field,
                value: entry.oldValue,
                version: newVersion,
              },
            ])
          }
        />
      )}
      {activeRowId && activeField && (
        <ConflictPopover
          rect={conflictRect}
          conflict={conflictKey !== null && conflictKey === dismissedKey ? null : conflict}
          field={activeField}
          locale={locale}
          onResolve={(choice) => {
            edits.resolveConflict(activeRowId, activeField, choice);
            focusActiveCell(); // the button that had focus disappears with the popover
          }}
          onClose={() => {
            setDismissedKey(conflictKey);
            focusActiveCell();
          }}
        />
      )}
    </div>
  );
};

export { EMPTY_QUERY, matchesFilter };
