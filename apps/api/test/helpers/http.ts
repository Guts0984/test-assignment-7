import http from 'node:http';
import net from 'node:net';

/**
 * Linux gives every 127.x.y.z address to the loopback interface, so a test can connect FROM a chosen address and the
 * server sees a genuinely different client. macOS (and Windows) have only 127.0.0.1: binding another one fails with
 * EADDRNOTAVAIL. There, `call` says who it is through X-Forwarded-For instead, and the test server trusts one proxy hop
 * (see startServer). The few tests that need REAL source addresses (spoofed headers must be ignored) are skipped there.
 */
export const realSourceAddresses: boolean = await new Promise<boolean>((resolve) => {
  if (process.env.NO_LOOPBACK_ALIASES) return resolve(false); // lets Linux rehearse the macOS path
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen({ host: '127.5.9.9', port: 0 }, () => probe.close(() => resolve(true)));
});

export type Res = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  setCookie: string[];
  raw: string;
};

/**
 * Real HTTP from a chosen *source address* (127.0.0.x all live on loopback), so a test can be
 * several distinct clients - an attacker and honest users - hitting one real server.
 */
export const call = (
  baseUrl: string,
  method: string,
  path: string,
  opts: {
    from?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): Promise<Res> =>
  new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const payload =
      opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        method,
        path,
        localAddress: realSourceAddresses ? opts.from : undefined,
        agent: false,
        headers: {
          ...(payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...(!realSourceAddresses && opts.from ? { 'x-forwarded-for': opts.from } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => (raw += d));
        res.on('end', () => {
          let body: unknown = raw;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* keep raw */
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            setCookie: res.headers['set-cookie'] ?? [],
            raw,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

export const cookieOf = (r: Res): string | undefined =>
  r.setCookie.find((c) => c.startsWith('sid='))?.split(';')[0];
