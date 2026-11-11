import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { loginRequestSchema, type LoginRequest, type Me } from '@catalog/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { DUMMY_HASH_PROMISE, verifyPassword } from '../common/password';
import { httpError } from '../common/http-error';
import { ipKey } from '../common/ip';
import { jsonSchema } from '../common/swagger';
import { zodPipe } from '../common/zod.pipe';
import { CONFIG, DB } from '../common/tokens';
import { CurrentUser, Public, type AuthUser } from './public.decorator';
import { RateLimitService } from './rate-limit.service';
import { SESSION_COOKIE, SessionService } from './session.service';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimitService) private readonly limiter: RateLimitService,
  ) {}

  private cookieOpts(expires?: Date) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.COOKIE_SECURE,
      path: '/',
      ...(expires ? { expires } : {}),
    };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a session (httpOnly cookie)' })
  @ApiBody({ schema: jsonSchema(loginRequestSchema) })
  async login(
    @Body(zodPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const cfg = this.config;
    const ip = ipKey(req.ip);
    // Three buckets, all counted *before* the password is checked (so parallel guessing is bounded exactly):
    //  - per client address: one noisy address cannot probe many accounts
    //  - per address+login: slows brute force of one account from one address
    //  - per login (high ceiling): safety net against distributed guessing
    // None of them is keyed by something an attacker can use to lock out *another* address.
    const [ipKeyName, pairKey, acctKey] = [
      `login:ip:${ip}`,
      `login:pair:${ip}:${body.login}`,
      `login:acct:${body.login}`,
    ] as const;
    const block = (retry: number): never => {
      res.setHeader('retry-after', String(retry));
      throw httpError(429, 'rate_limited', 'Too many login attempts, try again later', {
        retryAfterSec: retry,
      });
    };
    // The address bucket goes first and short-circuits: a flood from one address with random
    // logins cannot create unbounded pair/account rows (storage DoS), it stops after LOGIN_IP_LIMIT.
    const ipHit = await this.limiter.hit(ipKeyName, cfg.LOGIN_WINDOW_SECONDS);
    if (ipHit.count > cfg.LOGIN_IP_LIMIT) block(ipHit.retryAfterSec);
    const [pairHit, acctHit] = await Promise.all([
      this.limiter.hit(pairKey, cfg.LOGIN_WINDOW_SECONDS),
      this.limiter.hit(acctKey, cfg.LOGIN_WINDOW_SECONDS),
    ]);
    if (pairHit.count > cfg.LOGIN_PAIR_LIMIT) block(pairHit.retryAfterSec);
    if (acctHit.count > cfg.LOGIN_ACCOUNT_LIMIT) block(acctHit.retryAfterSec);

    const rows = await this.db.select().from(users).where(eq(users.login, body.login)).limit(1);
    const user = rows[0];
    // Always do a hash comparison, even for unknown logins, so response time does not reveal which logins exist.
    const ok = await verifyPassword(
      body.password,
      user?.passwordHash ?? (await DUMMY_HASH_PROMISE),
    );
    if (!user || !ok) throw httpError(401, 'unauthenticated', 'Invalid login or password');

    // Success: this attempt should not count against the user.
    await Promise.all([
      this.limiter.reset(pairKey),
      this.limiter.refund(ipKeyName),
      this.limiter.refund(acctKey),
    ]);

    // Fresh token on every login (no session fixation); drop whatever session was presented.
    const old: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof old === 'string') await this.sessions.destroy(old);
    const { token, expiresAt } = await this.sessions.create(user.id);
    res.cookie(SESSION_COOKIE, token, this.cookieOpts(expiresAt));
    const me = await this.sessions.resolve(token);
    if (!me) throw httpError(500, 'internal_error', 'Session could not be created');
    return me;
  }

  @Post('auth/logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const t: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof t === 'string') await this.sessions.destroy(t);
    res.clearCookie(SESSION_COOKIE, this.cookieOpts());
  }

  @Get('me')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Current user' })
  me(@CurrentUser() user: AuthUser): Me {
    return user;
  }
}
