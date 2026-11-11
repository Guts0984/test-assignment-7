import { isApiFailure } from '@/shared/api/error';
import type { SendError } from './sync-engine';

/**
 * Translates a failed HTTP call into what the queue needs to know:
 *  - network trouble / proxy 502-504 / a still-running duplicate / 429: retry (same key)
 *  - 401: the session is gone, stop and tell the user (edits stay queued)
 *  - anything else (400, 403 on the whole request, 422 key reuse...): the server will never accept this batch
 */
export const toSendError = (e: unknown): SendError => {
  if (!isApiFailure(e))
    return { retryable: true, message: e instanceof Error ? e.message : 'Unknown error' };
  if (e.status === 401) return { retryable: false, fatal: true, message: 'Session expired' };
  if (
    e.code === 'network' ||
    e.status === 502 ||
    e.status === 503 ||
    e.status === 504 ||
    e.status === 0
  ) {
    return { retryable: true, message: e.message };
  }
  if (e.status === 429 || e.code === 'idempotency_in_progress') {
    return { retryable: true, retryAfterSec: e.retryAfterSec ?? 1, message: e.message };
  }
  return { retryable: false, message: e.message };
};
