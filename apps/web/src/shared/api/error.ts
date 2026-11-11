import { apiErrorSchema, type ErrorCode } from '@catalog/shared';

/** Errors are plain Error objects with extra fields (no classes outside the NestJS app). */
export type ApiFailure = Error & {
  isApiFailure: true;
  status: number;
  code: ErrorCode | 'network' | 'unknown';
  details?: unknown;
  retryAfterSec?: number;
};

export const apiFailure = (
  status: number,
  code: ApiFailure['code'],
  message: string,
  extra: { details?: unknown; retryAfterSec?: number } = {},
): ApiFailure =>
  Object.assign(new Error(message), { isApiFailure: true as const, status, code, ...extra });

export const isApiFailure = (e: unknown): e is ApiFailure =>
  e instanceof Error && (e as Partial<ApiFailure>).isApiFailure === true;

/** Network trouble (offline, server restarting, proxy 502/503/504): safe to retry. */
export const isRetryable = (e: unknown): boolean =>
  isApiFailure(e) &&
  (e.code === 'network' || e.status === 502 || e.status === 503 || e.status === 504);

export const failureFromResponse = async (res: Response): Promise<ApiFailure> => {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON (e.g. proxy error page) */
  }
  const parsed = apiErrorSchema.safeParse(body);
  const retryAfter = Number(res.headers.get('retry-after'));
  const extra = {
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
  if (parsed.success) {
    return apiFailure(res.status, parsed.data.error.code, parsed.data.error.message, {
      ...extra,
      details: parsed.data.error.details,
    });
  }
  return apiFailure(
    res.status,
    res.status === 503 ? 'unavailable' : 'unknown',
    `HTTP ${res.status}`,
    extra,
  );
};
