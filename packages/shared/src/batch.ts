import { z } from 'zod';
import { fieldSchema } from './product';

export const BATCH_MAX = 1000;

export const changeSchema = z.object({
  id: z.uuid(),
  field: fieldSchema,
  value: z.unknown(),
  baseVersion: z.number().int().min(0),
});
export type Change = z.infer<typeof changeSchema>;

/** Where the edit came from; recorded in the history. */
export const BATCH_SOURCES = ['edit', 'paste', 'fill', 'undo'] as const;

export const batchRequestSchema = z.object({
  changes: z.array(changeSchema).min(1).max(BATCH_MAX),
  source: z.enum(BATCH_SOURCES).default('edit'),
});
export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type BatchRequestInput = z.input<typeof batchRequestSchema>;

const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: fieldSchema.optional(),
});

export const authorSchema = z.object({ id: z.uuid(), login: z.string() });

export const changeResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), newVersion: z.number().int(), value: z.unknown() }),
  z.object({ status: z.literal('invalid'), issues: z.array(issueSchema) }),
  z.object({
    status: z.literal('conflict'),
    currentValue: z.unknown(),
    currentVersion: z.number().int(),
    author: authorSchema.nullable(),
    changedAt: z.string(),
  }),
  z.object({ status: z.literal('forbidden'), reason: z.string() }),
  z.object({ status: z.literal('not_found') }),
  /** Another change for the same product failed, so this one was rolled back (atomic per product). */
  z.object({ status: z.literal('rolled_back') }),
]);
export type ChangeResult = z.infer<typeof changeResultSchema>;

export const batchResponseSchema = z.object({
  results: z.array(changeResultSchema),
});
export type BatchResponse = z.infer<typeof batchResponseSchema>;

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
