import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * jsonb that returns exactly what node-pg parsed. Drizzle's built-in jsonb runs JSON.parse a second
 * time on strings, turning the stored string "12.50" into the number 12.5 and "123" into 123.
 */
const jsonbRaw = customType<{ data: unknown; driverData: string | null }>({
  dataType: () => 'jsonb',
  toDriver: (v) => (v === null || v === undefined ? null : JSON.stringify(v)),
  fromDriver: (v) => v,
});

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    uniqueIndex('users_login_uq').on(t.login),
    check('users_role_ck', sql`${t.role} in ('admin','editor','viewer')`),
  ],
);

export const userCategories = pgTable(
  'user_categories',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the opaque cookie token; the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    price: numeric('price', { precision: 14, scale: 2 }),
    oldPrice: numeric('old_price', { precision: 14, scale: 2 }),
    stock: integer('stock').notNull().default(0),
    status: text('status').notNull().default('draft'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    arrivalDate: date('arrival_date', { mode: 'string' }),
    /** Per-field version counters, e.g. {"price": 3, "name": 0}. Bumped only when that field changes. */
    versions: jsonb('versions').$type<Record<string, number>>().notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('products_sku_uq').on(t.sku),
    index('products_category_idx').on(t.category),
    index('products_status_idx').on(t.status),
    check('products_price_ck', sql`${t.price} is null or ${t.price} > 0`),
    check(
      'products_old_price_ck',
      sql`${t.oldPrice} is null or (${t.price} is not null and ${t.oldPrice} > ${t.price})`,
    ),
    check('products_stock_ck', sql`${t.stock} >= 0`),
    check('products_name_ck', sql`char_length(${t.name}) between 1 and 200`),
    check('products_status_ck', sql`${t.status} in ('draft','active','archived')`),
    check(
      'products_active_ck',
      sql`${t.status} <> 'active' or (${t.price} is not null and ${t.category} is not null)`,
    ),
  ],
);

export const productChanges = pgTable(
  'product_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    oldValue: jsonbRaw('old_value'),
    newValue: jsonbRaw('new_value'),
    /** Version of the field after this change. */
    version: integer('version').notNull(),
    source: text('source').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    jobId: uuid('job_id'),
    createdAt: ts('created_at'),
  },
  (t) => [
    index('changes_product_field_idx').on(t.productId, t.field, t.id),
    index('changes_job_idx').on(t.jobId),
    check(
      'changes_source_ck',
      sql`${t.source} in ('edit','paste','fill','bulk','restore','revert','undo')`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    state: text('state').notNull(),
    statusCode: smallint('status_code'),
    response: jsonb('response'),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    check('idem_state_ck', sql`${t.state} in ('in_progress','done')`),
  ],
);

export const bulkJobs = pgTable(
  'bulk_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    filter: jsonb('filter').notNull(),
    operation: jsonb('operation').notNull(),
    status: text('status').notNull().default('queued'),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    applied: integer('applied').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    revertedCount: integer('reverted_count').notNull().default(0),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Who asked for the revert: the revert runs with *their* permissions, not the creator's. */
    revertUserId: uuid('revert_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Lease so a crashed worker's job becomes claimable again. */
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    lockedBy: text('locked_by'),
    createdAt: ts('created_at'),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('bulk_jobs_status_idx').on(t.status),
    check(
      'bulk_jobs_status_ck',
      sql`${t.status} in ('queued','running','cancelling','cancelled','done','failed','reverting','reverted')`,
    ),
  ],
);

/** Snapshot of the products a job targets; state transitions pending -> applied|skipped happen with the chunk commit. */
export const bulkJobItems = pgTable(
  'bulk_job_items',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => bulkJobs.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    seq: integer('seq').notNull(),
    /** pending | applied | skipped | reverted | revert_skipped */
    state: text('state').notNull().default('pending'),
    reason: text('reason'),
    message: text('message'),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.productId] }),
    index('bulk_items_pending_idx').on(t.jobId, t.state, t.seq),
  ],
);

/** Fixed-window counters for abuse protection (login, etc.), kept in PostgreSQL. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('rate_limits_window_idx').on(t.windowStart)],
);
