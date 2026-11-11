import { QueryClient } from '@tanstack/react-query';
import { isApiFailure } from './error';

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Do not hammer on auth/validation problems; do retry transient network ones.
        retry: (count, e) =>
          isApiFailure(e) && e.status >= 400 && e.status < 500 ? false : count < 2,
      },
    },
  });
