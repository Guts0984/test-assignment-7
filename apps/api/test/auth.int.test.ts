import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { apiErrorSchema, meSchema } from '@catalog/shared';
import { startServer, type TestServer } from './helpers/server';
import { call, cookieOf, realSourceAddresses } from './helpers/http';
import { hashPassword } from '../src/common/password';
import { RateLimitService } from '../src/auth/rate-limit.service';
import { createDb } from '../src/db/client';
import { TEST_PASSWORDS } from './helpers/db';

type Login = keyof typeof TEST_PASSWORDS;
let s: TestServer;
let pool: Pool;
let n = 0;
/** Each call gets its own honest "user address" so tests do not share rate-limit buckets. */
const freshIp = () => `127.1.${Math.floor(++n / 250)}.${(n % 250) + 1}`;

const login = (
  login: string,
  password: string,
  from?: string,
  extra: Record<string, string> = {},
) => call(s.baseUrl, 'POST', '/auth/login', { from, body: { login, password }, headers: extra });
const good = (l: Login, from = freshIp()) => login(l, TEST_PASSWORDS[l], from);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  s = await startServer({ LOGIN_WINDOW_SECONDS: '900' });
  pool = new Pool({ connectionString: s.databaseUrl });
}, 60_000);
afterAll(async () => {
  await pool?.end();
  await s?.stop();
});

describe('login and session basics', () => {
  it.each(['admin', 'editor1', 'editor2', 'viewer'] as const)(
    '%s can log in and /me matches the role',
    async (l) => {
      const r = await good(l);
      expect(r.status).toBe(200);
      const me = meSchema.parse(r.body);
      expect(me.login).toBe(l);
      const cookie = cookieOf(r)!;
      const m = await call(s.baseUrl, 'GET', '/me', { cookie });
      expect(m.status).toBe(200);
      expect(meSchema.parse(m.body)).toEqual(me);
      if (l.startsWith('editor')) expect(me.categories.length).toBe(5);
      else expect(me.categories).toEqual([]);
    },
  );

  it('cookie is httpOnly + SameSite and the raw token is not stored in the database', async () => {
    const r = await good('admin');
    const raw = r.setCookie.find((c) => c.startsWith('sid='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    const token = raw.split(';')[0]!.slice(4);
    const rows = await pool.query('select id from sessions where id = $1', [token]);
    expect(rows.rowCount).toBe(0); // only the hash is stored
    expect(r.body).not.toHaveProperty('passwordHash');
    expect(r.raw).not.toContain('scrypt$');
  });

  it('no cookie / garbage cookie / forged cookie -> 401', async () => {
    for (const cookie of [
      undefined,
      'sid=',
      'sid=garbage',
      `sid=${'a'.repeat(43)}`,
      `sid=${'a'.repeat(5000)}`,
      'sid[]=x',
      'sid=%00',
    ]) {
      const r = await call(s.baseUrl, 'GET', '/me', { cookie });
      expect(r.status, String(cookie)).toBe(401);
      apiErrorSchema.parse(r.body);
    }
  });

  it('logout invalidates the session server-side (stolen cookie stops working)', async () => {
    const cookie = cookieOf(await good('viewer'))!;
    expect((await call(s.baseUrl, 'GET', '/me', { cookie })).status).toBe(200);
    expect((await call(s.baseUrl, 'POST', '/auth/logout', { cookie })).status).toBe(204);
    expect((await call(s.baseUrl, 'GET', '/me', { cookie })).status).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    const cookie = cookieOf(await good('viewer'))!;
    await pool.query(`update sessions set expires_at = now() - interval '1 second'`);
    expect((await call(s.baseUrl, 'GET', '/me', { cookie })).status).toBe(401);
  });

  it('session fixation: a pre-set sid is destroyed and a new token is issued', async () => {
    const victim = cookieOf(await good('admin'))!;
    const r = await call(s.baseUrl, 'POST', '/auth/login', {
      from: freshIp(),
      cookie: victim,
      body: { login: 'viewer', password: TEST_PASSWORDS.viewer },
    });
    expect(cookieOf(r)).toBeTruthy();
    expect(cookieOf(r)).not.toBe(victim);
    expect((await call(s.baseUrl, 'GET', '/me', { cookie: victim })).status).toBe(401);
  });

  it('role/category changes apply to live sessions immediately', async () => {
    const cookie = cookieOf(await good('editor1'))!;
    const before = meSchema.parse((await call(s.baseUrl, 'GET', '/me', { cookie })).body);
    await pool.query(`delete from user_categories where user_id = $1 and category = $2`, [
      before.id,
      before.categories[0],
    ]);
    const after = meSchema.parse((await call(s.baseUrl, 'GET', '/me', { cookie })).body);
    expect(after.categories).toHaveLength(before.categories.length - 1);
  });
});

describe('hostile login input never causes 5xx and never logs in', () => {
  const bodies: [string, unknown][] = [
    ['NoSQL-style object login', { login: { $ne: '' }, password: 'x' }],
    ['object password', { login: 'admin', password: { $gt: '' } }],
    ['array login', { login: ['admin'], password: 'x' }],
    ['SQL injection login', { login: "admin' OR '1'='1' --", password: 'x' }],
    ['SQL injection password', { login: 'admin', password: "' OR 1=1 --" }],
    ['stacked query', { login: "x'; DROP TABLE users; --", password: 'x' }],
    ['null bytes', { login: 'admin\u0000', password: 'x' }],
    ['empty strings', { login: '', password: '' }],
    ['huge password', { login: 'admin', password: 'x'.repeat(100_000) }],
    ['numbers', { login: 1, password: 2 }],
    ['null', null],
    ['missing fields', {}],
    ['proto pollution', JSON.parse('{"__proto__":{"role":"admin"},"login":"a","password":"b"}')],
    ['unicode confusable', { login: 'аdmin', password: TEST_PASSWORDS.admin }], // Cyrillic "а"
    ['case variant', { login: 'ADMIN', password: TEST_PASSWORDS.admin }],
    ['padded login', { login: ' admin', password: TEST_PASSWORDS.admin }],
  ];
  it.each(bodies)('%s', async (_n, body) => {
    const r = await call(s.baseUrl, 'POST', '/auth/login', { from: freshIp(), body });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(cookieOf(r)).toBeUndefined();
    apiErrorSchema.parse(r.body);
  });
  it('users table survived the injection attempts', async () => {
    expect((await pool.query('select count(*)::int n from users')).rows[0].n).toBe(4);
  });
  it('unknown login and wrong password are indistinguishable', async () => {
    const a = await login('admin', 'wrong-password', freshIp());
    const b = await login('nobody-here', 'wrong-password', freshIp());
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const strip = (r: { body: unknown }) => {
      const e = apiErrorSchema.parse(r.body).error;
      return { code: e.code, message: e.message, details: e.details };
    };
    expect(strip(a)).toEqual(strip(b));
  });
  it('response time does not reveal whether a login exists', async () => {
    const time = async (l: string) => {
      const t: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        await login(l, 'wrong-password', freshIp());
        t.push(performance.now() - t0);
      }
      return t.sort((x, y) => x - y)[3]!;
    };
    const known = await time('admin');
    const unknown = await time('ghost-user');
    expect(Math.max(known, unknown) / Math.min(known, unknown)).toBeLessThan(2.5);
  });
});

describe('CSRF defence', () => {
  it('state-changing request from a foreign Origin is refused, even with a valid cookie', async () => {
    const cookie = cookieOf(await good('admin'))!;
    const r = await call(s.baseUrl, 'POST', '/auth/logout', {
      cookie,
      headers: { origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
    expect((await call(s.baseUrl, 'GET', '/me', { cookie })).status).toBe(200); // still logged in
    const l = await login('admin', TEST_PASSWORDS.admin, freshIp(), {
      origin: 'https://evil.example',
    });
    expect(l.status).toBe(403);
  });
  it('the configured web origin is allowed', async () => {
    const l = await login('viewer', TEST_PASSWORDS.viewer, freshIp(), {
      origin: 'http://localhost:3000',
    });
    expect(l.status).toBe(200);
  });
});

describe('brute force and rate-limit abuse (one real server, several real source addresses)', () => {
  it('attacker is cut off after 5 guesses at one account; response carries Retry-After', async () => {
    const attacker = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await login('admin', `guess-${i}`, attacker)).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    const r = await login('admin', 'guess-x', attacker);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('rate_limited');
  });

  it('even the CORRECT password is refused while the attacker is blocked (no oracle)', async () => {
    const attacker = freshIp();
    for (let i = 0; i < 6; i++) await login('editor1', `guess-${i}`, attacker);
    expect((await login('editor1', TEST_PASSWORDS.editor1, attacker)).status).toBe(429);
  });

  it('THE KEY PROPERTY: an attacker hammering an account does not lock out the real user or anyone else', async () => {
    const attacker = freshIp();
    for (let i = 0; i < 60; i++) await login('admin', `guess-${i}`, attacker);
    expect((await login('admin', 'x', attacker)).status).toBe(429);
    // honest users on other addresses are completely unaffected - including the targeted account:
    expect((await good('admin')).status).toBe(200);
    expect((await good('editor1')).status).toBe(200);
    expect((await good('viewer')).status).toBe(200);
    expect((await call(s.baseUrl, 'GET', '/health')).status).toBe(200);
  });

  it('one address spraying many logins is stopped by the per-address ceiling, others unaffected', async () => {
    const attacker = freshIp();
    const results: number[] = [];
    for (let i = 0; i < 45; i++) results.push((await login(`user-${i}`, 'pw', attacker)).status);
    expect(results.filter((c) => c === 401).length).toBe(30);
    expect(results.filter((c) => c === 429).length).toBe(15);
    expect((await good('viewer')).status).toBe(200);
  });

  it.skipIf(!realSourceAddresses)(
    'spoofed X-Forwarded-For / Forwarded / X-Real-IP do NOT create fresh identities (trust proxy is off)',
    async () => {
      const attacker = freshIp();
      const codes: number[] = [];
      for (let i = 0; i < 10; i++) {
        codes.push(
          (
            await login('admin', `guess-${i}`, attacker, {
              'x-forwarded-for': `10.9.${i}.${i}`,
              forwarded: `for=10.8.${i}.1`,
              'x-real-ip': `10.7.${i}.1`,
            })
          ).status,
        );
      }
      expect(codes.filter((c) => c === 401)).toHaveLength(5);
      expect(codes.filter((c) => c === 429)).toHaveLength(5);
    },
  );

  it.skipIf(!realSourceAddresses)(
    'a spoofed header cannot be used to frame an honest address either',
    async () => {
      const attacker = freshIp();
      const victimIp = freshIp();
      for (let i = 0; i < 40; i++)
        await login('admin', `g${i}`, attacker, { 'x-forwarded-for': victimIp });
      expect((await good('admin', victimIp)).status).toBe(200);
    },
  );

  it('a parallel burst of 300 guesses admits exactly 5 attempts (no check-then-act race)', async () => {
    const attacker = freshIp();
    const rs = await Promise.all(
      Array.from({ length: 300 }, (_, i) => login('viewer', `burst-${i}`, attacker)),
    );
    const count = (c: number) => rs.filter((r) => r.status === c).length;
    expect(count(401)).toBe(5);
    expect(count(429)).toBe(295);
    expect(rs.every((r) => r.status === 401 || r.status === 429)).toBe(true);
  });

  it('a successful login does not count against the user (4 misses + success + 4 misses is fine)', async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) expect((await login('viewer', `typo-${i}`, ip)).status).toBe(401);
    expect((await login('viewer', TEST_PASSWORDS.viewer, ip)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login('viewer', `typo-${i}`, ip)).status).toBe(401);
  });

  it('random-login flood from one address cannot bloat rate_limits (bounded rows)', async () => {
    const attacker = freshIp();
    const before = (await pool.query('select count(*)::int n from rate_limits')).rows[0]
      .n as number;
    await Promise.all(
      Array.from({ length: 400 }, (_, i) => login(`rand-${i}-${Math.random()}`, 'x', attacker)),
    );
    const after = (await pool.query('select count(*)::int n from rate_limits')).rows[0].n as number;
    expect(after - before).toBeLessThanOrEqual(1 + 30 * 2);
  });

  it('distributed guessing (many addresses) trips the per-account ceiling but other accounts still work', async () => {
    // 30 addresses x 4 attempts = 120 > 100. Documented trade-off: this account is throttled for the window.
    const codes: number[] = [];
    for (let a = 0; a < 30; a++) {
      const ip = freshIp();
      for (let i = 0; i < 4; i++) codes.push((await login('editor2', `d-${a}-${i}`, ip)).status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(20);
    expect((await good('viewer')).status).toBe(200);
    expect((await good('admin')).status).toBe(200);
  });

  it('a botnet cannot lock a user out of his own account from an address he has already used', async () => {
    const usual = freshIp();
    expect((await login('editor1', TEST_PASSWORDS.editor1, usual)).status).toBe(200); // becomes a known address
    // 30 other addresses x 4 wrong passwords = 120 attempts at the same account (> the account ceiling of 100)
    for (let a = 0; a < 30; a++) {
      const bot = freshIp();
      for (let i = 0; i < 4; i++) await login('editor1', `botnet-${a}-${i}`, bot);
    }
    // an address that has NEVER logged in to this account is throttled while it is under distributed attack...
    expect((await login('editor1', TEST_PASSWORDS.editor1, freshIp())).status).toBe(429);
    // ...but the owner's usual address is not locked out, and a wrong password from it is still just a 401
    expect((await login('editor1', TEST_PASSWORDS.editor1, usual)).status).toBe(200);
    expect((await login('editor1', 'wrong', usual)).status).toBe(401);
  });

  it('an attacker cannot become a "known address": wrong passwords never mark it', async () => {
    const attacker = freshIp();
    for (let i = 0; i < 3; i++)
      expect((await login('known-probe', `nope-${i}`, attacker)).status).toBe(401);
    const rows = await pool.query(
      `select key from rate_limits where key like 'login:ok:%' and key like '%:' || $1`,
      [attacker],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('the API stays responsive for others while an attacker floods', async () => {
    const attacker = freshIp();
    const flood = Promise.all(
      Array.from({ length: 300 }, (_, i) => login('admin', `flood-${i}`, attacker)),
    );
    const t0 = performance.now();
    const ok = await good('viewer');
    const health = await call(s.baseUrl, 'GET', '/health');
    expect(ok.status).toBe(200);
    expect(health.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(3_000);
    await flood;
  });
});

describe('rate limit windows', () => {
  it('attempts are allowed again after the window passes', async () => {
    const quick = await startServer({ LOGIN_WINDOW_SECONDS: '2', LOGIN_PAIR_LIMIT: '2' });
    try {
      const ip = '127.2.0.1';
      const go = () =>
        call(quick.baseUrl, 'POST', '/auth/login', {
          from: ip,
          body: { login: 'viewer', password: 'bad' },
        });
      expect((await go()).status).toBe(401);
      expect((await go()).status).toBe(401);
      expect((await go()).status).toBe(429);
      await new Promise((r) => setTimeout(r, 2_300));
      expect((await go()).status).toBe(401);
    } finally {
      await quick.stop();
    }
  }, 30_000);
});

describe('behind a trusted reverse proxy (TRUST_PROXY_HOPS=1)', () => {
  it('limits per real client address taken from X-Forwarded-For; clients are isolated from each other', async () => {
    const proxied = await startServer({ TRUST_PROXY_HOPS: '1' });
    try {
      const via = (client: string, l: string, pw: string) =>
        call(proxied.baseUrl, 'POST', '/auth/login', {
          from: '127.3.0.1', // the proxy
          headers: { 'x-forwarded-for': client },
          body: { login: l, password: pw },
        });
      for (let i = 0; i < 8; i++) await via('203.0.113.7', 'admin', `g${i}`);
      expect((await via('203.0.113.7', 'admin', 'again')).status).toBe(429);
      // a different client behind the same proxy is fine:
      expect((await via('203.0.113.8', 'admin', TEST_PASSWORDS.admin)).status).toBe(200);
      // the proxy's own address is not penalised for the attacker's behaviour:
      expect((await via('203.0.113.9', 'viewer', TEST_PASSWORDS.viewer)).status).toBe(200);
    } finally {
      await proxied.stop();
    }
  }, 30_000);
});

describe('shared addresses, returning users and mark retention', () => {
  const PW = 'a-long-test-password';
  const mkUser = async (login: string) => {
    await pool.query(`insert into users (login, password_hash, role) values ($1, $2, 'viewer')`, [
      login,
      await hashPassword(PW),
    ]);
  };
  const didOf = (r: { setCookie: string[] }) =>
    r.setCookie
      .find((c) => c.startsWith('did='))
      ?.split(';')[0]
      ?.slice(4);
  const botnet = async (login: string, addresses = 30, each = 4) => {
    for (let a = 0; a < addresses; a++) {
      const bot = freshIp();
      for (let i = 0; i < each; i++) await login_(login, `bot-${a}-${i}`, bot);
    }
  };
  const login_ = (l: string, pw: string, from: string, cookie?: string) =>
    call(s.baseUrl, 'POST', '/auth/login', { from, cookie, body: { login: l, password: pw } });

  it('a neighbour behind the SAME address cannot lock the real user out of his usual address', async () => {
    await mkUser('nat-victim');
    const shared = freshIp(); // office / campus / carrier NAT
    expect((await login_('nat-victim', PW, shared)).status).toBe(200); // the victim has used this address
    for (let i = 0; i < 6; i++)
      expect((await login_('nat-victim', `neighbour-${i}`, shared)).status).toBe(401); // > 5, not blocked
    expect((await login_('nat-victim', PW, shared)).status).toBe(200); // the victim still gets in
  });

  it('...but guessing from that shared address stays capped (the higher limit is not unlimited)', async () => {
    await mkUser('nat-capped');
    const shared = freshIp();
    await login_('nat-capped', PW, shared);
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await login_('nat-capped', `g-${i}`, shared)).status);
    expect(codes.filter((c) => c === 401).length).toBe(25);
    expect(codes.slice(25).every((c) => c === 429)).toBe(true);
  });

  it('an address that never logged in is still limited to 5 guesses', async () => {
    await mkUser('nat-stranger');
    const codes: number[] = [];
    for (let i = 0; i < 8; i++)
      codes.push((await login_('nat-stranger', `g-${i}`, freshIp())).status);
    const one = freshIp();
    const many: number[] = [];
    for (let i = 0; i < 8; i++) many.push((await login_('nat-stranger', `h-${i}`, one)).status);
    expect(many.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.every((c) => c === 401)).toBe(true); // 8 different addresses, 1 guess each
  });

  it('a returning user on a NEW address (device cookie) gets in while a botnet attacks his account; a stranger does not', async () => {
    await mkUser('dev-victim');
    const first = await login_('dev-victim', PW, freshIp());
    const did = didOf(first);
    expect(first.status).toBe(200);
    expect(did).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.setCookie.find((c) => c.startsWith('did='))).toMatch(/HttpOnly/i);
    await botnet('dev-victim');
    expect((await login_('dev-victim', PW, freshIp())).status).toBe(429); // a stranger with the right password: throttled
    expect((await login_('dev-victim', PW, freshIp(), `did=${did}`)).status).toBe(200); // the owner's browser: fine
    const stored = await pool.query(
      `select key from rate_limits where key like 'login:dev:dev-victim:%'`,
    );
    expect(stored.rows.map((r) => r.key).join()).not.toContain(did!); // only a hash is stored
  });

  it("a made-up or another user's device cookie does not exempt anybody", async () => {
    await mkUser('dev-target');
    await mkUser('dev-other');
    const other = didOf(await login_('dev-other', PW, freshIp()))!;
    await botnet('dev-target');
    expect((await login_('dev-target', PW, freshIp(), 'did=' + 'A'.repeat(43))).status).toBe(429);
    expect((await login_('dev-target', PW, freshIp(), `did=${other}`)).status).toBe(429);
    expect((await login_('dev-target', PW, freshIp(), 'did=short')).status).toBe(429);
  });

  it('known-address marks survive the purge for 30 days (only counters are short-lived)', async () => {
    const { db, pool: p2 } = createDb(s.databaseUrl, { max: 2 });
    const svc = new RateLimitService(db);
    const ins = (key: string, days: number) =>
      pool.query(
        `insert into rate_limits (key, count, window_start) values ($1, 1, now() - make_interval(days => $2))`,
        [key, days],
      );
    await ins('login:ok:purge-test:1.1.1.1', 5); // a mark from 5 days ago: must stay
    await ins('login:dev:purge-test:abc', 29);
    await ins('login:ok:purge-test:old', 40); // older than 35 days: goes
    await ins('login:pair:1.1.1.1:purge-test', 2); // an old counter: goes
    await ins('login:ip:2.2.2.2', 0); // a fresh counter: stays
    await svc.purge();
    const left = (
      await pool.query(
        `select key from rate_limits where key like '%purge-test%' or key = 'login:ip:2.2.2.2'`,
      )
    ).rows
      .map((r) => r.key as string)
      .sort();
    expect(left).toEqual([
      'login:dev:purge-test:abc',
      'login:ip:2.2.2.2',
      'login:ok:purge-test:1.1.1.1',
    ]);
    await p2.end();
  });
});
