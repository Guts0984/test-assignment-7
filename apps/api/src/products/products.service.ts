import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  EDITABLE_FIELDS,
  type BatchRequest,
  type BatchResponse,
  type ChangeResult,
  type HistoryEntry,
  type HistoryQuery,
  type ProductRow,
} from '@catalog/shared';
import type { Db } from '../db/client';
import { productChanges, products, users } from '../db/schema';
import { DB } from '../common/tokens';
import { httpError, notFound } from '../common/http-error';
import type { AuthUser } from '../auth/public.decorator';
import { applyProductChanges, stateOf, type ChangeInput } from './apply-changes';
import { IdempotencyService, hashBody } from './idempotency.service';

const CONCURRENCY = 4;

const mapPool = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
};

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  async list(): Promise<ProductRow[]> {
    const rows = await this.db.select().from(products).orderBy(products.sku);
    return rows.map((r) => ({
      id: r.id,
      ...stateOf(r),
      versions: Object.fromEntries(
        EDITABLE_FIELDS.map((f) => [f, r.versions[f] ?? 0]),
      ) as ProductRow['versions'],
    }));
  }

  /** Same product + field twice in one batch has no sane meaning (which baseVersion wins?), so it is a client error. */
  private assertNoDuplicates(body: BatchRequest): void {
    const seen = new Set<string>();
    for (const c of body.changes) {
      const k = `${c.id}:${c.field}`;
      if (seen.has(k)) {
        throw httpError(
          400,
          'validation_failed',
          'Duplicate change for the same product and field',
          { id: c.id, field: c.field },
        );
      }
      seen.add(k);
    }
  }

  async batch(me: AuthUser, body: BatchRequest, key: string | undefined) {
    this.assertNoDuplicates(body);
    const exec = () => this.execute(me, body);
    if (!key) return { body: await exec(), replayed: false };
    return this.idem.run(me.id, key, hashBody(body), exec);
  }

  private async execute(me: AuthUser, body: BatchRequest): Promise<BatchResponse> {
    const groups = new Map<string, { idx: number; c: ChangeInput }[]>();
    body.changes.forEach((c, idx) => {
      const g = groups.get(c.id) ?? [];
      g.push({ idx, c: { field: c.field, value: c.value, baseVersion: c.baseVersion } });
      groups.set(c.id, g);
    });

    // SKU uniqueness inside the batch: the first product (in request order) to claim a SKU keeps it.
    const claimed = new Map<string, string>();
    const dupSkusFor = new Map<string, Set<string>>();
    for (const [id, g] of groups) {
      for (const { c } of g) {
        if (c.field !== 'sku' || typeof c.value !== 'string') continue;
        const sku = c.value.trim();
        const owner = claimed.get(sku);
        if (owner && owner !== id) {
          const s = dupSkusFor.get(id) ?? new Set<string>();
          s.add(sku);
          dupSkusFor.set(id, s);
        } else claimed.set(sku, id);
      }
    }

    const results: ChangeResult[] = new Array(body.changes.length);
    await mapPool([...groups.entries()], CONCURRENCY, async ([id, g]) => {
      const res = await applyProductChanges(
        this.db,
        me,
        id,
        g.map((x) => x.c),
        {
          source: body.source,
          claimedSkus: dupSkusFor.get(id),
        },
      );
      g.forEach((x, i) => {
        results[x.idx] = res[i] as ChangeResult;
      });
    });
    return { results };
  }

  async history(productId: string, q: HistoryQuery): Promise<HistoryEntry[]> {
    const [p] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId));
    if (!p) throw notFound('Product not found');
    const rows = await this.db
      .select({ c: productChanges, login: users.login })
      .from(productChanges)
      .leftJoin(users, eq(users.id, productChanges.userId))
      .where(
        q.field
          ? and(eq(productChanges.productId, productId), eq(productChanges.field, q.field))
          : eq(productChanges.productId, productId),
      )
      .orderBy(desc(productChanges.id))
      .limit(q.limit);
    return rows.map(({ c, login }) => ({
      id: String(c.id),
      productId: c.productId,
      field: c.field as HistoryEntry['field'],
      oldValue: c.oldValue,
      newValue: c.newValue,
      version: c.version,
      source: c.source as HistoryEntry['source'],
      author: c.userId && login ? { id: c.userId, login } : null,
      jobId: c.jobId,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  /** Restore = an ordinary change that sets the field back to the entry's old value. */
  async restore(me: AuthUser, changeId: number, baseVersion: number): Promise<ChangeResult> {
    const [entry] = await this.db
      .select()
      .from(productChanges)
      .where(eq(productChanges.id, changeId));
    if (!entry) throw notFound('History entry not found');
    const [res] = await applyProductChanges(
      this.db,
      me,
      entry.productId,
      [{ field: entry.field as ChangeInput['field'], value: entry.oldValue, baseVersion }],
      { source: 'restore' },
    );
    return res as ChangeResult;
  }
}
