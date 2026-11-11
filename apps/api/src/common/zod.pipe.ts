import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { httpError } from './http-error';

/** Validates a body/query/param with a schema from @catalog/shared. Bad input is always a 400, never a 500. */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw httpError(
      400,
      'validation_failed',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    );
  }
}

export const zodPipe = <T>(schema: ZodType<T>): ZodPipe<T> => new ZodPipe(schema);
