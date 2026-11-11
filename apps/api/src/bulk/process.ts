import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  canEditCategory,
  type BulkOperation,
  type ChangeResult,
  type EditableField,
  type Me,
} from '@catalog/shared';
import type { Db } from '../db/client';
import {
  bulkJobItems,
  bulkJobs,
  productChanges,
  products,
  userCategories,
  users,
} from '../db/schema';
import {
  applyProductChangesTx,
  normalizeValue,
  sameValue,
  stateOf,
  type Tx,
} from '../products/apply-changes';
import { fieldOfOperation, planOperation } from './ops';

type Actor = Pick<Me, 'id' | 'role' | 'categories'>;
type Outcome = { state: string; reason?: string; message?: string };

/** The user the job runs as, loaded fresh each chunk so permission changes apply mid-job. */
export const loadActor = async (tx: Tx | Db, userId: string | null): Promise<Actor> => {
  if (!userId)
    return { id: '00000000-0000-0000-0000-000000000000', role: 'viewer', categories: [] };
  const [u] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return { id: userId, role: 'viewer', categories: [] };
  const cats =
    u.role === 'editor'
      ? await tx
          .select({ c: userCategories.category })
          .from(userCategories)
          .where(eq(userCategories.userId, userId))
      : [];
  return { id: u.id, role: u.role as Actor['role'], categories: cats.map((c) => c.c) };
};

const describe = (r: ChangeResult): Outcome => {
  switch (r.status) {
    case 'ok':
      return { state: 'applied' };
    case 'forbidden':
      return { state: 'skipped', reason: 'forbidden', message: r.reason };
    case 'not_found':
      return { state: 'skipped', reason: 'not_found', message: 'Product no longer exists' };
    case 'invalid':
      return {
        state: 'skipped',
        reason: 'invalid',
        message: r.issues.map((i) => i.message).join('; '),
      };
    case 'conflict':
      return { state: 'skipped', reason: 'conflict', message: 'Changed while the job was running' };
    default:
      return { state: 'skipped', reason: 'invalid', message: 'Rolled back' };
  }
};

/** One product, one SAVEPOINT: a database error on one product cannot poison the rest of the chunk. */
const applyOne = async (
  tx: Tx,
  actor: Actor,
  jobId: string,
  op: BulkOperation,
  productId: string,
): Promise<Outcome> =>
  tx.transaction(async (sp) => {
    const [row] = await sp.select().from(products).where(eq(products.id, productId)).for('update');
    if (!row) return { state: 'skipped', reason: 'not_found', message: 'Product no longer exists' };
    if (!canEditCategory(actor, row.category)) {
      return {
        state: 'skipped',
        reason: 'forbidden',
        message:
          actor.role === 'viewer' ? 'Read-only role' : 'Product is in a category you cannot edit',
      };
    }
    const plan = planOperation(op, stateOf(row));
    if (plan.kind === 'skip')
      return { state: 'skipped', reason: plan.reason, message: plan.message };
    // Same value as now -> nothing to do (and nothing to revert).
    if (
      sameValue(
        normalizeValue(plan.field, plan.value),
        normalizeValue(plan.field, stateOf(row)[plan.field]),
      )
    ) {
      return { state: 'skipped', reason: 'unchanged', message: 'Value already set' };
    }
    const [res] = await applyProductChangesTx(
      sp,
      actor,
      productId,
      [{ field: plan.field, value: plan.value, baseVersion: row.versions[plan.field] ?? 0 }],
      { source: 'bulk', jobId },
    );
    return describe(res as ChangeResult);
  });

/** Revert one product: only if nobody touched the field after the job did. */
const revertOne = async (
  tx: Tx,
  actor: Actor,
  jobId: string,
  field: EditableField,
  productId: string,
): Promise<Outcome> =>
  tx.transaction(async (sp) => {
    const [row] = await sp.select().from(products).where(eq(products.id, productId)).for('update');
    if (!row)
      return { state: 'revert_skipped', reason: 'not_found', message: 'Product no longer exists' };
    const [entry] = await sp
      .select()
      .from(productChanges)
      .where(
        and(
          eq(productChanges.jobId, jobId),
          eq(productChanges.productId, productId),
          eq(productChanges.field, field),
        ),
      )
      .orderBy(asc(productChanges.id))
      .limit(1);
    if (!entry)
      return {
        state: 'revert_skipped',
        reason: 'unchanged',
        message: 'No change from this job to revert',
      };
    if ((row.versions[field] ?? 0) !== entry.version) {
      return {
        state: 'revert_skipped',
        reason: 'changed_since',
        message: `${field} was changed after the job`,
      };
    }
    if (!canEditCategory(actor, row.category)) {
      return {
        state: 'revert_skipped',
        reason: 'forbidden',
        message: 'Product is in a category you cannot edit',
      };
    }
    const [res] = await applyProductChangesTx(
      sp,
      actor,
      productId,
      [{ field, value: entry.oldValue, baseVersion: entry.version }],
      { source: 'revert', jobId },
    );
    const o = describe(res as ChangeResult);
    return o.state === 'applied'
      ? { state: 'reverted' }
      : { state: 'revert_skipped', reason: o.reason, message: o.message };
  });

export type ChunkResult = 'more' | 'finished' | 'cancelled' | 'lost';

const release = { lockedBy: null, leaseUntil: null } as const;

/**
 * One chunk = one transaction holding the job row lock. Items, counters, history and the product
 * updates commit together, so a crash at any point leaves the chunk either fully applied or not at all
 * (nothing is ever applied twice), and nobody else can claim the job while the lock is held.
 */
export const runChunk = async (
  db: Db,
  jobId: string,
  workerId: string,
  opts: { chunkSize: number; leaseSeconds: number },
): Promise<ChunkResult> =>
  db.transaction(async (tx) => {
    const [job] = await tx.select().from(bulkJobs).where(eq(bulkJobs.id, jobId)).for('update');
    if (!job || job.lockedBy !== workerId) return 'lost';

    const reverting = job.status === 'reverting';
    if (job.status === 'cancelling') {
      await tx
        .update(bulkJobs)
        .set({ status: 'cancelled', finishedAt: new Date(), ...release })
        .where(eq(bulkJobs.id, jobId));
      return 'cancelled';
    }
    if (job.status !== 'running' && !reverting) return 'lost';

    const wanted = reverting ? 'applied' : 'pending';
    const items = await tx
      .select()
      .from(bulkJobItems)
      .where(and(eq(bulkJobItems.jobId, jobId), eq(bulkJobItems.state, wanted)))
      .orderBy(asc(bulkJobItems.seq))
      .limit(opts.chunkSize);

    if (items.length === 0) {
      await tx
        .update(bulkJobs)
        .set({ status: reverting ? 'reverted' : 'done', finishedAt: new Date(), ...release })
        .where(eq(bulkJobs.id, jobId));
      return 'finished';
    }

    const actor = await loadActor(tx, reverting ? (job.revertUserId ?? job.userId) : job.userId);
    const op = job.operation as BulkOperation;
    const field = fieldOfOperation(op);
    let applied = 0;
    let skipped = 0;
    // Ascending product-id order everywhere (snapshot is sorted by id) => concurrent jobs cannot deadlock.
    for (const item of items) {
      const o = reverting
        ? await revertOne(tx, actor, jobId, field, item.productId)
        : await applyOne(tx, actor, jobId, op, item.productId);
      if (o.state === 'applied' || o.state === 'reverted') applied++;
      else skipped++;
      await tx
        .update(bulkJobItems)
        .set({ state: o.state, reason: o.reason ?? null, message: o.message ?? null })
        .where(and(eq(bulkJobItems.jobId, jobId), eq(bulkJobItems.productId, item.productId)));
    }

    await tx
      .update(bulkJobs)
      .set(
        reverting
          ? {
              revertedCount: sql`${bulkJobs.revertedCount} + ${applied}`,
              leaseUntil: sql`now() + make_interval(secs => ${opts.leaseSeconds}::float8)`,
            }
          : {
              processed: sql`${bulkJobs.processed} + ${items.length}`,
              applied: sql`${bulkJobs.applied} + ${applied}`,
              skipped: sql`${bulkJobs.skipped} + ${skipped}`,
              leaseUntil: sql`now() + make_interval(secs => ${opts.leaseSeconds}::float8)`,
            },
      )
      .where(eq(bulkJobs.id, jobId));
    return 'more';
  });

/** Atomically claims the oldest claimable job (queued, or abandoned by a dead worker). */
export const claimJob = async (
  db: Db,
  workerId: string,
  leaseSeconds: number,
): Promise<{ id: string; status: string } | null> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: bulkJobs.id, status: bulkJobs.status })
      .from(bulkJobs)
      .where(
        and(
          inArray(bulkJobs.status, ['queued', 'running', 'cancelling', 'reverting']),
          sql`(${bulkJobs.leaseUntil} is null or ${bulkJobs.leaseUntil} < now())`,
        ),
      )
      .orderBy(asc(bulkJobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;
    const status = row.status === 'queued' ? 'running' : row.status;
    await tx
      .update(bulkJobs)
      .set({
        status,
        lockedBy: workerId,
        leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds}::float8)`,
      })
      .where(eq(bulkJobs.id, row.id));
    return { id: row.id, status };
  });

/** Give the job back (graceful shutdown) so another worker continues immediately, not after the lease. */
export const releaseJob = async (db: Db, jobId: string, workerId: string): Promise<void> => {
  await db
    .update(bulkJobs)
    .set({ ...release })
    .where(and(eq(bulkJobs.id, jobId), eq(bulkJobs.lockedBy, workerId)));
};

/** A job whose chunks keep failing for non-infrastructure reasons must not be retried forever. */
export const failJob = async (db: Db, jobId: string, workerId: string): Promise<void> => {
  await db
    .update(bulkJobs)
    .set({ status: 'failed', finishedAt: new Date(), ...release })
    .where(and(eq(bulkJobs.id, jobId), eq(bulkJobs.lockedBy, workerId)));
};
