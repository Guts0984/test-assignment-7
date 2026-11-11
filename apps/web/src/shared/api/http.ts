import type { ZodType } from 'zod';
import { apiFailure, failureFromResponse } from './error';

export type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  schema?: ZodType<T>;
  signal?: AbortSignal;
};

/** Browser talks to the same origin; Next proxies `/api/*` to the NestJS server. */
export const apiUrl = (path: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return new URL(`/api${path}`, origin).toString();
};

export const request = async <T = unknown>(
  path: string,
  opts: RequestOptions<T> = {},
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw apiFailure(0, 'network', 'Network error');
  }
  if (!res.ok) throw await failureFromResponse(res);
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  if (!opts.schema) return json as T;
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success)
    throw apiFailure(res.status, 'unknown', 'Unexpected response shape', {
      details: parsed.error.issues,
    });
  return parsed.data;
};
