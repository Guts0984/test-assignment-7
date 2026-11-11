import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { ProductRow } from '@catalog/shared';
import { fetchProducts, productKeys } from '../api/products-api';
import { patchRows, type RowPatch } from './cache';

export const useProducts = (enabled = true) =>
  useQuery({
    queryKey: productKeys.all,
    queryFn: fetchProducts,
    enabled,
    // Edits are applied to the cache by hand; a background refetch must not clobber unsaved work.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const getCachedRows = (qc: QueryClient): ProductRow[] | undefined =>
  qc.getQueryData<ProductRow[]>(productKeys.all);

export const patchCachedRows = (qc: QueryClient, patches: readonly RowPatch[]): void => {
  qc.setQueryData<ProductRow[]>(productKeys.all, (rows) =>
    rows ? patchRows(rows, patches) : rows,
  );
};
