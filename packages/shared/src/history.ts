import { z } from 'zod';
import { authorSchema } from './batch';
import { fieldSchema } from './product';

export const CHANGE_SOURCES = [
  'edit',
  'paste',
  'fill',
  'bulk',
  'restore',
  'revert',
  'undo',
] as const;
export const changeSourceSchema = z.enum(CHANGE_SOURCES);
export type ChangeSource = z.infer<typeof changeSourceSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  productId: z.uuid(),
  field: fieldSchema,
  oldValue: z.unknown(),
  newValue: z.unknown(),
  version: z.number().int(),
  source: changeSourceSchema,
  author: authorSchema.nullable(),
  jobId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyResponseSchema = z.object({ entries: z.array(historyEntrySchema) });
export const restoreRequestSchema = z.object({ baseVersion: z.number().int().min(0) });

/** Restore returns the single change result (see batch.ts); non-ok results are sent as 4xx errors. */
export const restoreParamSchema = z.object({ changeId: z.string().regex(/^\d{1,18}$/) });
export const historyQuerySchema = z.object({
  field: fieldSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
