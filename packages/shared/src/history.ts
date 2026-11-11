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
