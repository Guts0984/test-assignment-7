import { describe, expect, it } from 'vitest';
import { apiFailure } from '@/shared/api/error';
import { toSendError } from './send-error';

describe('toSendError', () => {
  it.each([
    ['offline', apiFailure(0, 'network', 'Network error')],
    ['bad gateway while the API restarts', apiFailure(502, 'unknown', 'x')],
    ['database down', apiFailure(503, 'unavailable', 'x')],
    ['gateway timeout', apiFailure(504, 'unknown', 'x')],
    ['unexpected non-API error (e.g. JSON parse)', new Error('boom')],
  ])('%s is retried', (_n, e) => expect(toSendError(e).retryable).toBe(true));

  it('429 waits for Retry-After; a still-running duplicate is retried soon', () => {
    expect(toSendError(apiFailure(429, 'rate_limited', 'x', { retryAfterSec: 9 }))).toMatchObject({
      retryable: true,
      retryAfterSec: 9,
    });
    expect(toSendError(apiFailure(409, 'idempotency_in_progress', 'x'))).toMatchObject({
      retryable: true,
      retryAfterSec: 1,
    });
  });
  it('401 is fatal (session expired): stop, keep edits, tell the user', () => {
    expect(toSendError(apiFailure(401, 'unauthenticated', 'x'))).toMatchObject({
      fatal: true,
      retryable: false,
    });
  });
  it.each([
    [400, 'validation_failed'],
    [403, 'forbidden'],
    [422, 'idempotency_key_reused'],
    [413, 'payload_too_large'],
  ] as const)('%i is final: retrying the same body can never succeed', (status, code) => {
    expect(toSendError(apiFailure(status, code, 'x')).retryable).toBe(false);
  });
});
