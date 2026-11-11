import { useQuery } from '@tanstack/react-query';
import { isApiFailure } from '@/shared/api/error';
import { fetchMe, sessionKeys } from '../api/session-api';

/** `data` is null when not signed in (401), undefined while loading. */
export const useMe = () =>
  useQuery({
    queryKey: sessionKeys.me,
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (e) {
        if (isApiFailure(e) && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
