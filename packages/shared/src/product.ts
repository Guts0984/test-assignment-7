import { z } from 'zod';
import { CATEGORIES } from './categories';
import { isDecimalString, compareDecimal } from './decimal';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const statusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof statusSchema>;

export const categorySchema = z.enum(CATEGORIES);

export const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'sku: letters, digits, . _ -');
export const nameSchema = z.string().trim().min(1).max(200);

export const priceSchema = z
  .string()
  // One refine on purpose: zod runs every refine even after one failed, and compareDecimal
  // throws on non-decimal input such as "1e3".
  .refine(
    (s) => isDecimalString(s) && compareDecimal(s, '0') > 0,
    'decimal > 0 with up to 2 fraction digits',
  );
export const stockSchema = z.number().int().min(0).max(2_147_483_647);

export const TAG_MAX_LEN = 50;
export const TAGS_MAX = 20;
export const tagSchema = z.string().trim().min(1).max(TAG_MAX_LEN);
export const tagsSchema = z
  .array(tagSchema)
  .max(TAGS_MAX)
  .refine((a) => new Set(a).size === a.length, 'tags must be unique');

/** Calendar date without time, "YYYY-MM-DD", must be a real date. */
export const isoDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    y >= 1900 &&
    y <= 2100
  );
};
export const dateSchema = z.string().refine(isoDate, 'YYYY-MM-DD calendar date');

/** Fields a user can edit through the grid. `id` is never editable. */
export const EDITABLE_FIELDS = [
  'sku',
  'name',
  'category',
  'price',
  'oldPrice',
  'stock',
  'status',
  'tags',
  'arrivalDate',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const fieldSchema = z.enum(EDITABLE_FIELDS);

/** Per-field value validators. Nullable fields accept null (= cleared). */
export const fieldValueSchemas = {
  sku: skuSchema,
  name: nameSchema,
  category: categorySchema.nullable(),
  price: priceSchema.nullable(),
  oldPrice: priceSchema.nullable(),
  stock: stockSchema,
  status: statusSchema,
  tags: tagsSchema,
  arrivalDate: dateSchema.nullable(),
} as const satisfies Record<EditableField, z.ZodType>;

export const productStateSchema = z.object({
  sku: fieldValueSchemas.sku,
  name: fieldValueSchemas.name,
  category: fieldValueSchemas.category,
  price: fieldValueSchemas.price,
  oldPrice: fieldValueSchemas.oldPrice,
  stock: fieldValueSchemas.stock,
  status: fieldValueSchemas.status,
  tags: fieldValueSchemas.tags,
  arrivalDate: fieldValueSchemas.arrivalDate,
});
export type ProductState = z.infer<typeof productStateSchema>;

export type FieldVersions = Record<EditableField, number>;

/** Row as served by GET /products. */
export const productRowSchema = productStateSchema.extend({
  id: z.uuid(),
  versions: z.record(fieldSchema, z.number().int().min(0)),
});
export type ProductRow = z.infer<typeof productRowSchema>;

export const NULLABLE_FIELDS: readonly EditableField[] = [
  'category',
  'price',
  'oldPrice',
  'arrivalDate',
];
