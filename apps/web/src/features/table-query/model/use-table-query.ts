'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { parseQuery, serializeQuery, type TableQuery } from '@/entities/product';
import { useRouter } from '@/shared/i18n/navigation';

/**
 * Sort and filters live in the URL: reload restores them, and every change is a history entry
 * so the browser's Back button steps through them.
 */
export const useTableQuery = (): { query: TableQuery; setQuery: (next: TableQuery) => void } => {
  const params = useSearchParams();
  const router = useRouter();
  const search = params?.toString() ?? '';
  const query = useMemo(() => parseQuery(new URLSearchParams(search)), [search]);
  const setQuery = useCallback(
    (next: TableQuery) => {
      const qs = serializeQuery(next).toString();
      if (qs === search) return; // no-op changes must not pollute the history
      router.push(qs ? `/?${qs}` : '/');
    },
    [router, search],
  );
  return { query, setQuery };
};
