import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  IDEMPOTENCY_HEADER,
  createBulkJobSchema,
  idempotencyKeySchema,
  previewBulkJobSchema,
  type BulkJob,
  type CreateBulkJob,
  type ProductFilter,
} from '@catalog/shared';
import { httpError } from '../common/http-error';
import { jsonSchema } from '../common/swagger';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles, type AuthUser } from '../auth/public.decorator';
import { BulkService } from './bulk.service';

const idParam = z.uuid();

@ApiTags('bulk-jobs')
@ApiCookieAuth('sid')
@Controller('bulk-jobs')
export class BulkController {
  constructor(@Inject(BulkService) private readonly bulk: BulkService) {}

  @Post('preview')
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({ summary: 'How many products a filter matches (and how many you may change)' })
  @ApiBody({ schema: jsonSchema(previewBulkJobSchema) })
  preview(
    @CurrentUser() me: AuthUser,
    @Body(zodPipe(previewBulkJobSchema)) body: { filter: ProductFilter },
  ) {
    return this.bulk.preview(me, body.filter);
  }

  @Post()
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Start a background bulk change over a filter' })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: false,
    description: 'Repeating the same request returns the same job instead of starting another',
  })
  @ApiBody({ schema: jsonSchema(createBulkJobSchema) })
  async create(
    @CurrentUser() me: AuthUser,
    @Body(zodPipe(createBulkJobSchema)) body: CreateBulkJob,
    @Headers('idempotency-key') rawKey: string | string[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BulkJob> {
    let key: string | undefined;
    if (rawKey !== undefined) {
      const k = idempotencyKeySchema.safeParse(rawKey);
      if (!k.success) throw httpError(400, 'validation_failed', 'Invalid Idempotency-Key header');
      key = k.data;
    }
    const out = await this.bulk.createOnce(me, body, key);
    if (out.replayed) res.setHeader('idempotent-replayed', 'true');
    return out.job;
  }

  @Get()
  @ApiOperation({ summary: 'Your recent jobs (all jobs for admins), no reports' })
  async list(@CurrentUser() me: AuthUser): Promise<{ jobs: BulkJob[] }> {
    return { jobs: await this.bulk.list(me) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Job progress and report' })
  get(@CurrentUser() me: AuthUser, @Param('id', zodPipe(idParam)) id: string): Promise<BulkJob> {
    return this.bulk.get(me, id);
  }

  @Post(':id/cancel')
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop at the next chunk boundary; applied part stays' })
  cancel(@CurrentUser() me: AuthUser, @Param('id', zodPipe(idParam)) id: string): Promise<BulkJob> {
    return this.bulk.cancel(me, id);
  }

  @Post(':id/revert')
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Undo the job through history; cells changed later are left alone and reported',
  })
  revert(@CurrentUser() me: AuthUser, @Param('id', zodPipe(idParam)) id: string): Promise<BulkJob> {
    return this.bulk.revert(me, id);
  }
}
