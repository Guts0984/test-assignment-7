import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ApiError, type ErrorCode } from '@catalog/shared';

const codeForStatus = (status: number): ErrorCode => {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
    case 405:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return status >= 500 ? 'internal_error' : 'bad_request';
  }
};

type Mapped = { status: number; body: ApiError['error'] };

/** PostgreSQL SQLSTATEs that mean "the client sent something the database refuses" -> 4xx, or "DB is away" -> 503. */
const mapPgError = (e: { code?: string; constraint?: string }): Mapped | null => {
  const c = e.code ?? '';
  if (c === '23505')
    return {
      status: 409,
      body: { code: 'conflict', message: 'Duplicate value', details: { constraint: e.constraint } },
    };
  if (c.startsWith('22') || c === '23514' || c === '23502' || c === '23503') {
    return {
      status: 400,
      body: { code: 'validation_failed', message: 'Value rejected by the database' },
    };
  }
  if (c === '40001' || c === '40P01') {
    return { status: 503, body: { code: 'unavailable', message: 'Temporary conflict, retry' } };
  }
  if (c.startsWith('08') || c.startsWith('57') || c.startsWith('53') || c === '3D000') {
    return { status: 503, body: { code: 'unavailable', message: 'Database unavailable' } };
  }
  return null;
};

const NET_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const mapped = mapException(exception);
    if (mapped.status >= 500) {
      this.log.error(
        `${req.method} ${req.originalUrl} -> ${mapped.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    const requestId = (req as Request & { id?: string }).id;
    if (res.headersSent) return;
    res.status(mapped.status).json({ error: { ...mapped.body, requestId } } satisfies ApiError);
  }
}

export const mapException = (e: unknown): Mapped => {
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const r = e.getResponse();
    const inner =
      typeof r === 'object' && r !== null && 'error' in r ? (r as { error: unknown }).error : null;
    if (
      inner &&
      typeof inner === 'object' &&
      'code' in inner &&
      ERROR_CODES.includes((inner as { code: ErrorCode }).code)
    ) {
      return { status, body: inner as ApiError['error'] };
    }
    return {
      status,
      body: { code: codeForStatus(status), message: status >= 500 ? 'Internal error' : e.message },
    };
  }
  if (typeof e === 'object' && e !== null) {
    const o = e as {
      type?: string;
      status?: number;
      statusCode?: number;
      code?: string;
      expose?: boolean;
    };
    // body-parser / http-errors (malformed JSON, too large, bad charset, ...)
    const st = o.status ?? o.statusCode;
    if (o.type && typeof st === 'number' && st >= 400 && st < 500) {
      return {
        status: st,
        body: {
          code: codeForStatus(st),
          message: o.type === 'entity.too.large' ? 'Payload too large' : 'Malformed request',
        },
      };
    }
    const pg = mapPgError(o);
    if (pg) return pg;
    if (o.code && NET_ERRORS.has(o.code))
      return { status: 503, body: { code: 'unavailable', message: 'Database unavailable' } };
    if (
      o.code === 'ECONNRESET' ||
      (e instanceof Error &&
        /Connection terminated|timeout exceeded when trying to connect/i.test(e.message))
    ) {
      return { status: 503, body: { code: 'unavailable', message: 'Database unavailable' } };
    }
  }
  return { status: 500, body: { code: 'internal_error', message: 'Internal error' } };
};
