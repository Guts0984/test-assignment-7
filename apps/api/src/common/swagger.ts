import { z, type ZodType } from 'zod';

/** OpenAPI-compatible JSON Schema straight from the shared Zod schema (single source of truth). */
export const jsonSchema = (schema: ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any', io: 'input' }) as Record<
    string,
    unknown
  >;
