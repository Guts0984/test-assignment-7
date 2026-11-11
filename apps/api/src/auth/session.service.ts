import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { roleSchema } from '@catalog/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { sessions, userCategories, users } from '../db/schema';
import { CONFIG, DB } from '../common/tokens';
import type { AuthUser } from './public.decorator';

export const SESSION_COOKIE = 'sid';
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Returns an opaque token; only its hash is stored, so a DB leak does not yield usable sessions. */
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3_600_000);
    await this.db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
    if (Math.random() < 0.02) void this.purgeExpired().catch(() => undefined);
    return { token, expiresAt };
  }

  /** Looks up the user fresh on every request, so role/category changes apply immediately. */
  async resolve(token: string): Promise<AuthUser | null> {
    if (token.length < 20 || token.length > 128) return null;
    const rows = await this.db
      .select({ id: users.id, login: users.login, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const u = rows[0];
    if (!u) return null;
    const role = roleSchema.safeParse(u.role);
    if (!role.success) return null;
    const cats =
      role.data === 'editor'
        ? await this.db
            .select({ c: userCategories.category })
            .from(userCategories)
            .where(eq(userCategories.userId, u.id))
        : [];
    return { id: u.id, login: u.login, role: role.data, categories: cats.map((c) => c.c) };
  }

  async destroy(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }

  async purgeExpired(): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }
}
