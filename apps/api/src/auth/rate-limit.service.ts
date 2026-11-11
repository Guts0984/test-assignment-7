import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { DB } from '../common/tokens';

export type HitResult = { count: number; retryAfterSec: number };

/**
 * Fixed-window counters in PostgreSQL. `hit` is one atomic upsert, so N parallel requests are
 * counted exactly N times (no check-then-increment race that lets a burst slip through).
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async hit(key: string, windowSec: number): Promise<HitResult> {
    const r = await this.db.execute<{ count: number; retry: number }>(sql`
      insert into rate_limits (key, count, window_start) values (${key}, 1, now())
      on conflict (key) do update set
        count = case when rate_limits.window_start <= now() - make_interval(secs => ${windowSec}::float8)
                     then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start <= now() - make_interval(secs => ${windowSec}::float8)
                            then now() else rate_limits.window_start end
      returning count,
        extract(epoch from (window_start + make_interval(secs => ${windowSec}::float8) - now()))::float8 as retry`);
    const row = r.rows[0];
    if (Math.random() < 0.01) void this.purge().catch(() => undefined);
    return {
      count: Number(row?.count ?? 1),
      retryAfterSec: Math.max(1, Math.ceil(Number(row?.retry ?? windowSec))),
    };
  }

  /** Give back one attempt (used when a login turned out to be successful). */
  async refund(key: string): Promise<void> {
    await this.db.execute(
      sql`update rate_limits set count = greatest(count - 1, 0) where key = ${key}`,
    );
  }

  /** Is there a live entry for this key (younger than `windowSec`)? Does not count anything. */
  async isActive(key: string, windowSec: number): Promise<boolean> {
    const r = await this.db.execute<{ one: number }>(
      sql`select 1 as one from rate_limits where key = ${key} and window_start > now() - make_interval(secs => ${windowSec}::float8)`,
    );
    return (r.rows?.length ?? 0) > 0;
  }

  /** Remember `key` for `windowSec` (sliding from now). */
  async mark(key: string): Promise<void> {
    await this.db.execute(sql`
      insert into rate_limits (key, count, window_start) values (${key}, 1, now())
      on conflict (key) do update set count = 1, window_start = now()`);
  }

  async reset(key: string): Promise<void> {
    await this.db.execute(sql`delete from rate_limits where key = ${key}`);
  }

  async purge(): Promise<void> {
    await this.db.execute(
      sql`delete from rate_limits where window_start < now() - interval '1 day'`,
    );
  }
}
