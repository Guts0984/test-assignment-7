import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createBulkJobSchema,
  previewBulkJobSchema,
  type BulkJob,
  type CreateBulkJob,
  type ProductFilter,
} from '@catalog/shared';
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
  @ApiBody({ schema: jsonSchema(createBulkJobSchema) })
  create(
    @CurrentUser() me: AuthUser,
    @Body(zodPipe(createBulkJobSchema)) body: CreateBulkJob,
  ): Promise<BulkJob> {
    return this.bulk.create(me, body);
  }

  @Get()
  @ApiOperation({ summary: 'Recent jobs (no reports)' })
  async list(): Promise<{ jobs: BulkJob[] }> {
    return { jobs: await this.bulk.list() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Job progress and report' })
  get(@Param('id', zodPipe(idParam)) id: string): Promise<BulkJob> {
    return this.bulk.get(id);
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
