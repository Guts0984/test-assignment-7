import { z } from 'zod';

export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_key_reused',
  'idempotency_in_progress',
  'rate_limited',
  'payload_too_large',
  'bad_request',
  'unsupported_media_type',
  'internal_error',
  'unavailable',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
