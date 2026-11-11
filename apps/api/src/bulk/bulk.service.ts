import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  canEditCategory,
  type BulkJob,
  type BulkOperation,
  type CreateBulkJob,
  type ProductFilter,
  type SkipItem,
} from '@catalog/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { bulkJobItems, bulkJobs, products, users } from '../db/schema';
import { CONFIG, DB } from '../common/tokens';
import { forbidden, httpError, notFound } from '../common/http-error';
import type { AuthUser } from '../auth/public.decorator';
import { filterWhere } from './filter';
import { validateOperation } from './ops';

const REPORT_CAP = 200;
const ACTIVE = ['queued', 'running', 'cancelling', 'reverting'];

@Injectable()
export class BulkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async preview(me: AuthUser, filter: ProductFilter): Promise<{ count: number; editable: number }> {
    const where = filterWhere(filter);
    const [{ n } = { n: 0 }] = await this.db.select({ n: count() }).from(products).where(where);
    if (me.role === 'admin') return { count: n, editable: n };
    if (me.role === 'viewer' || me.categories.length === 0) return { count: n, editable: 0 };
    const mine = inArray(products.category, me.categories);
    const [{ m } = { m: 0 }] = await this.db
      .select({ m: count() })
      .from(products)
      .where(where ? and(where, mine) : mine);
    return { count: n, editable: m };
  }

  async create(me: AuthUser, body: CreateBulkJob): Promise<BulkJob> {
    const problem = validateOperation(body.operation);
    if (problem) throw httpError(400, 'validation_failed', problem);

    const [{ n } = { n: 0 }] = await this.db
      .select({ n: count() })
      .from(bulkJobs)
      .where(and(eq(bulkJobs.userId, me.id), inArray(bulkJobs.status, ACTIVE)));
    if (n >= this.config.BULK_MAX_ACTIVE_PER_USER) {
      throw httpError(
        429,
        'rate_limited',
        'Too many bulk jobs are already running; wait for one to finish',
      );
    }

    const id = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .insert(bulkJobs)
        .values({ userId: me.id, filter: body.filter, operation: body.operation })
        .returning({ id: bulkJobs.id });
      if (!job) throw new Error('job insert failed');
      // Snapshot the targets once. Sorted by id: every worker locks products in this same order.
      const res = await tx.execute(sql`
        insert into bulk_job_items (job_id, product_id, seq)
        select ${job.id}::uuid, products.id, row_number() over (order by products.id)
        from products
        where ${filterWhere(body.filter) ?? sql`true`}`);
      await tx
        .update(bulkJobs)
        .set({ total: res.rowCount ?? 0 })
        .where(eq(bulkJobs.id, job.id));
      return job.id;
    });
    return this.get(me, id);
  }

  private async items(jobId: string, states: string[]): Promise<SkipItem[]> {
    const rows = await this.db
      .select({
        productId: bulkJobItems.productId,
        sku: products.sku,
        reason: bulkJobItems.reason,
        message: bulkJobItems.message,
      })
      .from(bulkJobItems)
      .leftJoin(products, eq(products.id, bulkJobItems.productId))
      .where(and(eq(bulkJobItems.jobId, jobId), inArray(bulkJobItems.state, states)))
      .orderBy(bulkJobItems.seq)
      .limit(REPORT_CAP);
    return rows.map((r) => ({
      productId: r.productId,
      sku: r.sku ?? '(deleted)',
      reason: (r.reason ?? 'invalid') as SkipItem['reason'],
      message: r.message ?? '',
    }));
  }

  private async view(
    row: typeof bulkJobs.$inferSelect,
    login: string | null,
    withReports: boolean,
  ): Promise<BulkJob> {
    const [report, revertReport] = withReports
      ? await Promise.all([this.items(row.id, ['skipped']), this.items(row.id, ['revert_skipped'])])
      : [[], []];
    return {
      id: row.id,
      status: row.status as BulkJob['status'],
      filter: row.filter as ProductFilter,
      operation: row.operation as BulkOperation,
      total: row.total,
      processed: row.processed,
      applied: row.applied,
      skipped: row.skipped,
      revertedCount: row.revertedCount,
      author: row.userId && login ? { id: row.userId, login } : null,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      report,
      revertReport,
    };
  }

  /**
   * A job carries its author, filter and the SKUs it skipped, so it is visible to its creator and to admins
   * only. Anyone else gets 404 (not 403): the existence of someone else's job is not revealed either.
   */
  async get(me: AuthUser, id: string): Promise<BulkJob> {
    const [r] = await this.db
      .select({ j: bulkJobs, login: users.login })
      .from(bulkJobs)
      .leftJoin(users, eq(users.id, bulkJobs.userId))
      .where(eq(bulkJobs.id, id));
    if (!r || (me.role !== 'admin' && r.j.userId !== me.id)) throw notFound('Job not found');
    return this.view(r.j, r.login, true);
  }

  async list(me: AuthUser): Promise<BulkJob[]> {
    const rows = await this.db
      .select({ j: bulkJobs, login: users.login })
      .from(bulkJobs)
      .leftJoin(users, eq(users.id, bulkJobs.userId))
      .where(me.role === 'admin' ? undefined : eq(bulkJobs.userId, me.id))
      .orderBy(desc(bulkJobs.createdAt))
      .limit(20);
    return Promise.all(rows.map((r) => this.view(r.j, r.login, false)));
  }

  /** Only the creator or an admin may stop or undo a job. */
  private assertOwner(me: AuthUser, userId: string | null): void {
    if (me.role !== 'admin' && me.id !== userId) throw notFound('Job not found'); // same answer as for a missing job
  }

  async cancel(me: AuthUser, id: string): Promise<BulkJob> {
    await this.db.transaction(async (tx) => {
      const [job] = await tx.select().from(bulkJobs).where(eq(bulkJobs.id, id)).for('update');
      if (!job) throw notFound('Job not found');
      this.assertOwner(me, job.userId);
      if (job.status === 'queued') {
        await tx
          .update(bulkJobs)
          .set({ status: 'cancelled', finishedAt: new Date() })
          .where(eq(bulkJobs.id, id));
      } else if (job.status === 'running') {
        // The worker notices at the next chunk boundary; what was applied so far stays.
        await tx
          .update(bulkJobs)
          .set({ status: 'cancelling', cancelRequested: true })
          .where(eq(bulkJobs.id, id));
      } else if (job.status !== 'cancelling' && job.status !== 'cancelled') {
        throw httpError(409, 'conflict', `A job that is ${job.status} cannot be cancelled`);
      }
    });
    return this.get(me, id);
  }

  async revert(me: AuthUser, id: string): Promise<BulkJob> {
    await this.db.transaction(async (tx) => {
      const [job] = await tx.select().from(bulkJobs).where(eq(bulkJobs.id, id)).for('update');
      if (!job) throw notFound('Job not found');
      this.assertOwner(me, job.userId);
      if (job.status === 'reverting') return; // double click: already on its way
      if (!['done', 'cancelled', 'failed'].includes(job.status)) {
        throw httpError(409, 'conflict', `A job that is ${job.status} cannot be reverted`);
      }
      if (me.role === 'viewer') throw forbidden('Read-only role');
      await tx
        .update(bulkJobs)
        .set({
          status: 'reverting',
          revertUserId: me.id,
          finishedAt: null,
          lockedBy: null,
          leaseUntil: null,
        })
        .where(eq(bulkJobs.id, id));
    });
    return this.get(me, id);
  }
}

export { canEditCategory };
