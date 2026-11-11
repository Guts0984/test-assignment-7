import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { apiErrorSchema } from '@catalog/shared';
import { startServer, type TestServer } from './helpers/server';

let s: TestServer;
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  s = await startServer();
}, 60_000);
afterAll(async () => {
  await s?.stop();
});

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(s.baseUrl + path, { method: 'POST', body, headers });

/** Raw socket request: lets us send things fetch() refuses to (bad percent-encoding, junk). */
const raw = (payload: string): Promise<string> =>
  new Promise((resolve) => {
    const u = new URL(s.baseUrl);
    const sock = net.connect(Number(u.port), u.hostname, () => sock.write(payload));
    let out = '';
    sock.on('data', (d) => (out += d.toString()));
    sock.on('end', () => resolve(out));
    sock.on('error', () => resolve(out));
    sock.setTimeout(5_000, () => {
      sock.destroy();
      resolve(out);
    });
  });
const statusOf = (r: string) => Number(/^HTTP\/1\.1 (\d{3})/.exec(r)?.[1]);

describe('health and readiness', () => {
  it('GET /health is 200 and /ready is 200 with DB up', async () => {
    expect((await fetch(s.baseUrl + '/health')).status).toBe(200);
    expect((await fetch(s.baseUrl + '/ready')).status).toBe(200);
  });
  it('/ready goes 503 while shutting down but /health stays 200', async () => {
    s.lifecycle.shuttingDown = true;
    expect((await fetch(s.baseUrl + '/ready')).status).toBe(503);
    expect((await fetch(s.baseUrl + '/health')).status).toBe(200);
    s.lifecycle.shuttingDown = false;
  });
});

describe('unified error format, never 5xx for bad input', () => {
  it('unknown route -> 404 in the standard shape', async () => {
    const r = await fetch(s.baseUrl + '/nope');
    expect(r.status).toBe(404);
    const j = apiErrorSchema.parse(await r.json());
    expect(j.error.requestId).toBeTruthy();
    expect(r.headers.get('x-request-id')).toBe(j.error.requestId);
  });
  it.each([
    ['malformed JSON', '{"a":', 'application/json'],
    ['trailing garbage', '{"a":1}}}', 'application/json'],
    ['bare string (strict mode)', '"hello"', 'application/json'],
    ['BOM + junk', '﻿{', 'application/json'],
    ['unsupported charset', '{}', 'application/json; charset=utf-7'],
  ])('%s -> 4xx JSON error', async (_n, body, ct) => {
    const r = await post('/auth/login', body, { 'content-type': ct });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.headers.get('content-type')).toContain('application/json');
    apiErrorSchema.parse(await r.json());
  });
  it('oversize body -> 413 without buffering it all', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
    const r = await post('/auth/login', big, { 'content-type': 'application/json' });
    expect(r.status).toBe(413);
    expect(apiErrorSchema.parse(await r.json()).error.code).toBe('payload_too_large');
  });
  it('deeply nested JSON does not crash the process', async () => {
    const deep = '['.repeat(50_000) + ']'.repeat(50_000);
    const r = await post('/auth/login', deep, { 'content-type': 'application/json' });
    expect(r.status).toBeLessThan(500);
    expect((await fetch(s.baseUrl + '/health')).status).toBe(200);
  });
  it.each([
    ['bad percent-encoding', 'GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['null byte in path', 'GET /health%00 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['path traversal', 'GET /../../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['bad query encoding', 'GET /health?x=%ZZ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    [
      'huge query string',
      `GET /health?${'a=1&'.repeat(1000)} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
    ],
    ['TRACE method', 'TRACE /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
  ])('%s never yields 5xx', async (_n, req) => {
    const res = await raw(req);
    const st = statusOf(res);
    expect(st === 200 || (st >= 400 && st < 500)).toBe(true);
  });
  it('oversized headers are rejected with 431 and the server survives', async () => {
    const res = await raw(
      `GET /health HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(100_000)}\r\nConnection: close\r\n\r\n`,
    );
    expect([431, 400, NaN]).toContain(statusOf(res));
    expect((await fetch(s.baseUrl + '/health')).status).toBe(200);
  });
  it('slow/half-open connections do not block other requests', async () => {
    const u = new URL(s.baseUrl);
    const socks = Array.from({ length: 50 }, () => {
      const sock = net.connect(Number(u.port), u.hostname);
      sock.on('error', () => undefined);
      sock.write('POST /auth/login HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{');
      return sock;
    });
    const t0 = Date.now();
    expect((await fetch(s.baseUrl + '/health')).status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1_000);
    socks.forEach((x) => x.destroy());
  });
});

describe('hardening headers & docs', () => {
  it('does not advertise the framework and disables sniffing/caching', async () => {
    const r = await fetch(s.baseUrl + '/health');
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('swagger UI is served on /docs and the JSON lists the health routes', async () => {
    expect((await fetch(s.baseUrl + '/docs')).status).toBe(200);
    const j = (await (await fetch(s.baseUrl + '/docs-json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(j.paths)).toEqual(expect.arrayContaining(['/health', '/ready']));
  });
});

describe('load', () => {
  it('200 concurrent requests all succeed', async () => {
    const rs = await Promise.all(Array.from({ length: 200 }, () => fetch(s.baseUrl + '/health')));
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });
});
