import http from 'node:http';

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
        localAddress: opts.from,
        agent: false,
        headers: {
          ...(payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
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
