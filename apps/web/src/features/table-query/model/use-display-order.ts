'use client';

import { useMemo, useReducer } from 'react';
import { matchesFilter, type ProductRow } from '@catalog/shared';
import { computeOrder, serializeQuery, type Labeler, type TableQuery } from '@/entities/product';

/**
 * Which rows are shown, in which order.
 *
 * The order is recomputed when the person changes the sort/filter, when the language changes (labels
 * sort differently), when the data is first loaded, and on an explicit refresh - but NOT when a cell
 * value is edited. So a row that stops matching the filter (or moves in the sort order) after an edit
 * stays exactly where the cursor is; the toolbar offers a refresh instead.
 */
export const useDisplayOrder = (
  rows: readonly ProductRow[] | undefined,
  query: TableQuery,
  locale: string,
  collator: Intl.Collator,
  label: Labeler,
): { order: readonly string[]; staleCount: number; refresh: () => void } => {
  const [epoch, refresh] = useReducer((n: number) => n + 1, 0);
  const loaded = rows !== undefined;
  const queryKey = serializeQuery(query).toString();

  const order = useMemo(
    () => (rows ? computeOrder(rows, query, collator, label) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally NOT depending on `rows`: editing a cell must not reorder or drop rows under the cursor
    [loaded, queryKey, locale, epoch],
  );

  const staleCount = useMemo(() => {
    if (!rows || Object.keys(query.filter).length === 0) return 0;
    const byId = new Map(rows.map((r) => [r.id, r]));
    let n = 0;
    for (const id of order) {
      const r = byId.get(id);
      if (r && !matchesFilter(r, query.filter)) n++;
    }
    return n;
  }, [rows, order, query.filter]);

  return { order, staleCount, refresh };
};
