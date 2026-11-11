import { and, desc, eq, ne } from 'drizzle-orm';
import {
  EDITABLE_FIELDS,
  canEditCategory,
  fieldValueSchemas,
  normalizeDecimal,
  validateProductState,
  type ChangeResult,
  type ChangeSource,
  type EditableField,
  type Me,
  type ProductState,
} from '@catalog/shared';
import type { Db } from '../db/client';
import { productChanges, products, users } from '../db/schema';

export type ChangeInput = { field: EditableField; value: unknown; baseVersion: number };
export type ApplyContext = {
  source: ChangeSource;
  jobId?: string | null;
  /** SKUs already claimed by another product earlier in the same batch. */
  claimedSkus?: ReadonlySet<string>;
};

type Row = typeof products.$inferSelect;
type Issue = { code: string; message: string; field?: EditableField };
type Actor = Pick<Me, 'id' | 'role' | 'categories'>;

export const stateOf = (p: Row): ProductState => ({
  sku: p.sku,
  name: p.name,
  category: p.category as ProductState['category'],
  price: p.price,
  oldPrice: p.oldPrice,
  stock: p.stock,
  status: p.status as ProductState['status'],
  tags: p.tags,
  arrivalDate: p.arrivalDate,
});

/** Canonical form so "12.5" and "12.50" are the same value. */
export const normalizeValue = (field: EditableField, v: unknown): unknown =>
  (field === 'price' || field === 'oldPrice') && typeof v === 'string' ? normalizeDecimal(v) : v;

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const versionOf = (row: Row, f: EditableField): number => row.versions[f] ?? 0;

const lastAuthor = async (
  db: Pick<Db, 'select'>,
  productId: string,
  field: EditableField,
  row: Row,
) => {
  const [r] = await db
    .select({ id: users.id, login: users.login, at: productChanges.createdAt })
    .from(productChanges)
    .leftJoin(users, eq(users.id, productChanges.userId))
    .where(and(eq(productChanges.productId, productId), eq(productChanges.field, field)))
    .orderBy(desc(productChanges.id))
    .limit(1);
  return {
    author: r?.id && r.login ? { id: r.id, login: r.login } : null,
    changedAt: (r?.at ?? row.updatedAt).toISOString(),
  };
};

const failAll = (changes: ChangeInput[], failing: Map<number, ChangeResult>): ChangeResult[] =>
  changes.map((_, i) => failing.get(i) ?? { status: 'rolled_back' });

/**
 * Applies the changes of ONE product in ONE transaction, with the product row locked.
 *
 *  - per-field versions: a change conflicts only if *that field* moved since `baseVersion`
 *  - conflicts drop just that change; the rest of the product's changes are still applied
 *  - any validation / permission failure rolls back every change of the product (atomic per product)
 *  - cross-field rules are checked on the resulting state of the product
 *  - history rows are written in the same transaction as the update
 *
 * Results are aligned with `changes` by index.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Same as applyProductChanges but inside a transaction the caller already holds (bulk worker chunks). */
export const applyProductChangesTx = async (
  tx: Tx,
  me: Actor,
  productId: string,
  changes: ChangeInput[],
  ctx: ApplyContext,
): Promise<ChangeResult[]> => {
  const [row] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
  if (!row) return changes.map((): ChangeResult => ({ status: 'not_found' }));

  if (!canEditCategory(me, row.category)) {
    return changes.map((): ChangeResult => ({
      status: 'forbidden',
      reason: me.role === 'viewer' ? 'Read-only role' : 'Product is in a category you cannot edit',
    }));
  }

  const failing = new Map<number, ChangeResult>();
  const conflicts = new Map<number, ChangeResult>();
  const noops = new Map<number, ChangeResult>();
  const toApply: { i: number; field: EditableField; value: unknown; old: unknown }[] = [];

  for (const [i, c] of changes.entries()) {
    const parsed = fieldValueSchemas[c.field].safeParse(c.value);
    if (!parsed.success) {
      failing.set(i, {
        status: 'invalid',
        issues: [
          {
            code: 'invalidValue',
            field: c.field,
            message: parsed.error.issues[0]?.message ?? 'invalid value',
          },
        ],
      });
      continue;
    }
    const value = normalizeValue(c.field, parsed.data);
    const current = normalizeValue(c.field, stateOf(row)[c.field]);

    if (
      c.field === 'category' &&
      me.role === 'editor' &&
      !canEditCategory(me, value as string | null)
    ) {
      failing.set(i, {
        status: 'forbidden',
        reason: 'You cannot move a product into a category you do not edit',
      });
      continue;
    }
    if (c.field === 'sku' && typeof value === 'string' && ctx.claimedSkus?.has(value)) {
      failing.set(i, {
        status: 'invalid',
        issues: [
          {
            code: 'sku_duplicate_in_batch',
            field: 'sku',
            message: 'SKU appears twice in this batch',
          },
        ],
      });
      continue;
    }
    // Writing the value that is already there is a no-op, never a conflict.
    if (sameValue(value, current)) {
      noops.set(i, { status: 'ok', newVersion: versionOf(row, c.field), value: current });
      continue;
    }
    const version = versionOf(row, c.field);
    if (c.baseVersion !== version) {
      const { author, changedAt } = await lastAuthor(tx, productId, c.field, row);
      conflicts.set(i, {
        status: 'conflict',
        currentValue: current,
        currentVersion: version,
        author,
        changedAt,
      });
      continue;
    }
    toApply.push({ i, field: c.field, value, old: current });
  }

  const finish = (extra: Map<number, ChangeResult> = new Map()): ChangeResult[] =>
    changes.map(
      (_, i) =>
        extra.get(i) ??
        failing.get(i) ??
        conflicts.get(i) ??
        noops.get(i) ?? { status: 'rolled_back' },
    );

  if (failing.size > 0) return finish();
  if (toApply.length === 0) return finish();

  // Cross-field rules on the state the product will have *after* these changes.
  const next: ProductState = { ...stateOf(row) };
  for (const a of toApply) (next as Record<string, unknown>)[a.field] = a.value;
  const issues = validateProductState(next);
  if (issues.length > 0) {
    const touched = new Set(toApply.map((a) => a.field));
    const direct = issues.filter((x) => touched.has(x.field));
    const out = new Map<number, ChangeResult>();
    // Show the problem on the edited cell when there is one; otherwise on every edited cell
    // (the issue still names the real field, e.g. editing price breaks the untouched oldPrice).
    for (const a of toApply) {
      const mine = (direct.length ? direct : issues).filter(
        (x) => direct.length === 0 || x.field === a.field,
      );
      if (mine.length) {
        out.set(a.i, {
          status: 'invalid',
          issues: mine.map((x): Issue => ({
            code: x.code,
            message: x.message,
            field: x.field,
          })),
        });
      }
    }
    return finish(out);
  }

  const skuChange = toApply.find((a) => a.field === 'sku');
  if (skuChange) {
    const [clash] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.sku, skuChange.value as string), ne(products.id, productId)))
      .limit(1);
    if (clash) {
      return finish(
        new Map([
          [
            skuChange.i,
            {
              status: 'invalid',
              issues: [{ code: 'sku_taken', field: 'sku', message: 'SKU already exists' }],
            },
          ],
        ]),
      );
    }
  }

  const versions = { ...row.versions };
  const patch: Record<string, unknown> = {};
  const applied = new Map<number, ChangeResult>();
  const history = toApply.map((a) => {
    const v = (versions[a.field] ?? 0) + 1;
    versions[a.field] = v;
    patch[a.field] = a.value;
    applied.set(a.i, { status: 'ok', newVersion: v, value: a.value });
    return {
      productId,
      field: a.field,
      oldValue: a.old,
      newValue: a.value,
      version: v,
      source: ctx.source,
      userId: me.id,
      jobId: ctx.jobId ?? null,
    };
  });
  await tx
    .update(products)
    .set({ ...patch, versions, updatedAt: new Date() })
    .where(eq(products.id, productId));
  // Same transaction as the update: history can never disagree with the data.
  await tx.insert(productChanges).values(history);
  return finish(applied);
};

export const applyProductChanges = async (
  db: Db,
  me: Actor,
  productId: string,
  changes: ChangeInput[],
  ctx: ApplyContext,
): Promise<ChangeResult[]> => {
  try {
    return await db.transaction((tx) => applyProductChangesTx(tx, me, productId, changes, ctx));
  } catch (e) {
    // Lost a race for a unique SKU between our check and the write: report it as a normal invalid result.
    if (isUniqueViolation(e, 'products_sku_uq')) {
      const failing = new Map<number, ChangeResult>();
      changes.forEach((c, i) => {
        if (c.field === 'sku') {
          failing.set(i, {
            status: 'invalid',
            issues: [{ code: 'sku_taken', field: 'sku', message: 'SKU already exists' }],
          });
        }
      });
      return failAll(changes, failing);
    }
    throw e;
  }
};

export const isUniqueViolation = (e: unknown, constraint: string): boolean => {
  let cur: unknown = e;
  for (let d = 0; d < 3 && typeof cur === 'object' && cur !== null; d++) {
    const o = cur as { code?: string; constraint?: string; cause?: unknown };
    if (o.code === '23505' && o.constraint === constraint) return true;
    cur = o.cause;
  }
  return false;
};

export { EDITABLE_FIELDS };
