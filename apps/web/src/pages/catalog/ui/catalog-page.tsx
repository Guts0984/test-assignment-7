'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { matchesFilter } from '@catalog/shared';
import {
  hasActiveFilter,
  makeCollator,
  nextSort,
  useProducts,
  EMPTY_QUERY,
  type TableQuery,
} from '@/entities/product';
import { useMe } from '@/entities/session';
import { ColumnFilter, useDisplayOrder, useTableQuery } from '@/features/table-query';
import { SyncIndicator, useProductEdits, type SyncOptions } from '@/features/sync-changes';
import { AppHeader } from '@/widgets/app-header';
import { createGridStore, ProductGrid, type GridCommand } from '@/widgets/product-grid';
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

  useEffect(() => {
    if (me.data === null) router.replace('/login');
  }, [me.data, router]);

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

  const onCommand = (cmd: GridCommand) => {
    if (cmd.type === 'undo') edits.undo();
    else if (cmd.type === 'redo') edits.redo();
  };

  if (!me.data) return null;
  const total = rows?.length ?? 0;

  return (
    <div className="flex h-screen flex-col">
      <AppHeader me={me.data} />
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2">
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
        <span className="flex-1" />
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
        <SyncIndicator status={edits.status} />
      </div>
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
              store={gridStore}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export { EMPTY_QUERY, matchesFilter };
