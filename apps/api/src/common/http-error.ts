import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@catalog/shared';

/** Every error the API raises on purpose goes through here so the body shape never varies. */
export const httpError = (
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): HttpException => new HttpException({ error: { code, message, details } }, status);

export const unauthenticated = () => httpError(401, 'unauthenticated', 'Authentication required');
export const forbidden = (msg = 'Forbidden') => httpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => httpError(404, 'not_found', msg);
