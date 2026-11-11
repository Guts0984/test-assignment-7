import { z } from 'zod';
import { authorSchema } from './batch';
import { categorySchema, priceSchema, statusSchema, tagSchema, fieldValueSchemas } from './product';
import { isDecimalString } from './decimal';

const decimalStr = z.string().refine(isDecimalString, 'decimal');

/** Filter shared by the grid and bulk jobs (so "current filter" means the same on both sides). */
export const productFilterSchema = z.object({
  sku: z.string().max(100).optional(),
  name: z.string().max(200).optional(),
  category: z.array(categorySchema).max(20).optional(),
  status: z.array(statusSchema).max(3).optional(),
  priceMin: decimalStr.optional(),
  priceMax: decimalStr.optional(),
  stockMin: z.number().int().min(0).optional(),
  stockMax: z.number().int().min(0).optional(),
});
export type ProductFilter = z.infer<typeof productFilterSchema>;

export const NUMERIC_BULK_FIELDS = ['price', 'oldPrice', 'stock'] as const;
export const SETTABLE_BULK_FIELDS = [
  'name',
  'category',
  'price',
  'oldPrice',
  'stock',
  'status',
  'arrivalDate',
] as const;

export const bulkOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set'),
    field: z.enum(SETTABLE_BULK_FIELDS),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal('adjust'),
    field: z.enum(NUMERIC_BULK_FIELDS),
    mode: z.enum(['percent', 'absolute']),
    /** Signed decimal, e.g. "10", "-2.5". Percent is bounded to keep results sane. */
    amount: z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/),
  }),
  z.object({ type: z.literal('addTag'), tag: tagSchema }),
  z.object({ type: z.literal('removeTag'), tag: tagSchema }),
]);
export type BulkOperation = z.infer<typeof bulkOperationSchema>;

export const createBulkJobSchema = z.object({
  filter: productFilterSchema,
  operation: bulkOperationSchema,
});
export type CreateBulkJob = z.infer<typeof createBulkJobSchema>;

export const previewBulkJobSchema = z.object({ filter: productFilterSchema });

export const BULK_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'cancelled',
  'done',
  'failed',
  'reverting',
  'reverted',
] as const;
export const bulkStatusSchema = z.enum(BULK_STATUSES);
export type BulkStatus = z.infer<typeof bulkStatusSchema>;

export const SKIP_REASONS = [
  'forbidden',
  'invalid',
  'conflict',
  'changed_since',
  'not_found',
] as const;
export const skipItemSchema = z.object({
  productId: z.uuid(),
  sku: z.string(),
  field: z.string().optional(),
  reason: z.enum(SKIP_REASONS),
  message: z.string(),
});
export type SkipItem = z.infer<typeof skipItemSchema>;

export const bulkJobSchema = z.object({
  id: z.uuid(),
  status: bulkStatusSchema,
  filter: productFilterSchema,
  operation: bulkOperationSchema,
  total: z.number().int(),
  processed: z.number().int(),
  applied: z.number().int(),
  skipped: z.number().int(),
  revertedCount: z.number().int(),
  author: authorSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Capped list; `skipped` holds the real count. */
  report: z.array(skipItemSchema),
  revertReport: z.array(skipItemSchema),
});
export type BulkJob = z.infer<typeof bulkJobSchema>;

export const previewResponseSchema = z.object({ count: z.number().int() });

// Re-exported for api convenience when validating `set` values per field.
export { fieldValueSchemas, priceSchema };
