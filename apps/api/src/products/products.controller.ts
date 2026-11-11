import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  IDEMPOTENCY_HEADER,
  batchRequestSchema,
  historyQuerySchema,
  idempotencyKeySchema,
  restoreParamSchema,
  restoreRequestSchema,
  type BatchRequest,
  type BatchResponse,
  type ChangeResult,
  type HistoryEntry,
  type HistoryQuery,
  type ProductRow,
} from '@catalog/shared';
import { httpError } from '../common/http-error';
import { jsonSchema } from '../common/swagger';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles, type AuthUser } from '../auth/public.decorator';
import { ProductsService } from './products.service';

const idParam = z.uuid();

@ApiTags('products')
@ApiCookieAuth('sid')
@Controller()
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get('products')
  @ApiOperation({ summary: 'All products with per-field versions' })
  async list(): Promise<{ products: ProductRow[] }> {
    return { products: await this.products.list() };
  }

  @Patch('products/batch')
  @Roles('admin', 'editor')
  @ApiOperation({
    summary: 'Apply up to 1000 cell changes (per-field versions, atomic per product)',
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: false,
    description: 'Repeat of the same body returns the same response',
  })
  @ApiBody({ schema: jsonSchema(batchRequestSchema) })
  async batch(
    @CurrentUser() me: AuthUser,
    @Body(zodPipe(batchRequestSchema)) body: BatchRequest,
    @Headers('idempotency-key') rawKey: string | string[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BatchResponse> {
    let key: string | undefined;
    if (rawKey !== undefined) {
      const k = idempotencyKeySchema.safeParse(rawKey);
      if (!k.success) throw httpError(400, 'validation_failed', 'Invalid Idempotency-Key header');
      key = k.data;
    }
    const out = await this.products.batch(me, body, key);
    if (out.replayed) res.setHeader('idempotent-replayed', 'true');
    return out.body;
  }

  @Get('products/:id/history')
  @ApiOperation({ summary: 'Change history of a product (newest first)' })
  async history(
    @Param('id', zodPipe(idParam)) id: string,
    @Query(zodPipe(historyQuerySchema)) q: HistoryQuery,
  ): Promise<{ entries: HistoryEntry[] }> {
    return { entries: await this.products.history(id, q) };
  }

  @Post('history/:changeId/restore')
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set the field back to the value it had before this history entry' })
  async restore(
    @CurrentUser() me: AuthUser,
    @Param(zodPipe(restoreParamSchema)) p: { changeId: string },
    @Body(zodPipe(restoreRequestSchema)) body: { baseVersion: number },
  ): Promise<{ result: ChangeResult }> {
    const result = await this.products.restore(me, Number(p.changeId), body.baseVersion);
    switch (result.status) {
      case 'ok':
        return { result };
      case 'conflict':
        throw httpError(409, 'conflict', 'The field changed since you loaded it', result);
      case 'forbidden':
        throw httpError(403, 'forbidden', result.reason);
      case 'not_found':
        throw httpError(404, 'not_found', 'Product not found');
      default:
        throw httpError(400, 'validation_failed', 'Restoring this value is not allowed', result);
    }
  }
}
