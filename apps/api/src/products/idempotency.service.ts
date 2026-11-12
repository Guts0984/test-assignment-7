import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { DB } from '../common/tokens';
import { httpError } from '../common/http-error';

const WAIT_MS = 30_000;
/** A key whose owner has not shown a sign of life for this long is taken over. */
const STALE_MS = 60_000;
const POLL_MS = 40;

export type IdempotencyTuning = { staleMs?: number; heartbeatMs?: number };

/** JSON with sorted keys, so semantically equal bodies hash equal regardless of key order. */
export const canonicalJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};

export const hashBody = (v: unknown): string =>
  createHash('sha256').update(canonicalJson(v)).digest('hex');

export type Idempotent<T> = { body: T; replayed: boolean };

@Injectable()
export class IdempotencyService {
  private readonly staleMs: number;
  private readonly heartbeatMs: number;

  constructor(
    @Inject(DB) private readonly db: Db,
    tuning: IdempotencyTuning = {},
  ) {
    this.staleMs = tuning.staleMs ?? STALE_MS;
    this.heartbeatMs = tuning.heartbeatMs ?? Math.floor(this.staleMs / 4);
  }

  /**
   * Runs `fn` at most once per (user, key). Concurrent duplicates wait for the first and get its
   * response; the same key with a different body is 422; a crashed first attempt is retried
   * after STALE_MS; a failed attempt releases the key so the client's retry can proceed.
   */
  async run<T extends object>(
    userId: string,
    key: string,
    requestHash: string,
    fn: () => Promise<T>,
  ): Promise<Idempotent<T>> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const claimed = await this.db
        .insert(idempotencyKeys)
        .values({ userId, key, requestHash, state: 'in_progress' })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (claimed.length) return this.own(userId, key, fn);

      const [row] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      if (!row) continue; // owner failed and released it between our insert and select
      if (row.requestHash !== requestHash) {
        throw httpError(
          422,
          'idempotency_key_reused',
          'Idempotency-Key was already used with a different request body',
        );
      }
      if (row.state === 'done') return { body: row.response as T, replayed: true };

      if (Date.now() - row.createdAt.getTime() > this.staleMs) {
        // Owner presumably crashed mid-flight: take over atomically (only one taker wins).
        const took = await this.db
          .update(idempotencyKeys)
          .set({ createdAt: new Date() })
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.state, 'in_progress'),
              lt(idempotencyKeys.createdAt, new Date(Date.now() - this.staleMs)),
            ),
          )
          .returning({ key: idempotencyKeys.key });
        if (took.length) return this.own(userId, key, fn);
      }
      if (Date.now() > deadline) {
        throw httpError(
          409,
          'idempotency_in_progress',
          'The original request with this key is still being processed',
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  private async own<T extends object>(
    userId: string,
    key: string,
    fn: () => Promise<T>,
  ): Promise<Idempotent<T>> {
    let body: T;
    // The owner proves it is alive while it works: a slow but healthy request must not be mistaken for a crashed
    // one (a retry would take the key over and run the batch a second time).
    const beat = setInterval(() => {
      void this.db
        .update(idempotencyKeys)
        .set({ createdAt: new Date() })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.state, 'in_progress'),
          ),
        )
        .catch(() => undefined);
    }, this.heartbeatMs);
    try {
      body = await fn();
    } catch (e) {
      await this.db
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
        .catch(() => undefined);
      throw e;
    } finally {
      clearInterval(beat);
    }
    await this.db
      .update(idempotencyKeys)
      .set({ state: 'done', statusCode: 200, response: body })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (Math.random() < 0.01) {
      void this.db
        .delete(idempotencyKeys)
        .where(sql`${idempotencyKeys.createdAt} < now() - interval '1 day'`)
        .catch(() => undefined);
    }
    return { body, replayed: false };
  }
}
