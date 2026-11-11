import {
  batchResponseSchema,
  productRowSchema,
  type ChangeResult,
  type ProductRow,
} from '@catalog/shared';
import { z } from 'zod';
import { call, cookieOf, type Res } from './http';
import { TEST_PASSWORDS } from './db';
import type { TestServer } from './server';

export type Who = keyof typeof TEST_PASSWORDS;
let n = 0;
/** A private source address per login so rate limits never interfere with functional tests. */
const freshIp = () => `127.5.${Math.floor(++n / 250)}.${(n % 250) + 1}`;

export type Session = { cookie: string; login: Who };

export const loginAs = async (s: TestServer, who: Who): Promise<Session> => {
  const r = await call(s.baseUrl, 'POST', '/auth/login', {
    from: freshIp(),
    body: { login: who, password: TEST_PASSWORDS[who] },
  });
  if (r.status !== 200) throw new Error(`login ${who} failed: ${r.status} ${r.raw}`);
  return { cookie: cookieOf(r)!, login: who };
};

export const listProducts = async (s: TestServer, ses: Session): Promise<ProductRow[]> => {
  const r = await call(s.baseUrl, 'GET', '/products', { cookie: ses.cookie });
  if (r.status !== 200) throw new Error(`GET /products ${r.status}`);
  return z.object({ products: z.array(productRowSchema) }).parse(r.body).products;
};

export type Ch = { id: string; field: string; value: unknown; baseVersion: number };

export const patchBatch = (
  s: TestServer,
  ses: Session,
  changes: Ch[],
  opts: { key?: string; source?: string; from?: string } = {},
): Promise<Res> =>
  call(s.baseUrl, 'PATCH', '/products/batch', {
    cookie: ses.cookie,
    from: opts.from,
    headers: opts.key ? { 'idempotency-key': opts.key } : {},
    body: { changes, ...(opts.source ? { source: opts.source } : {}) },
  });

export const results = (r: Res): ChangeResult[] => {
  if (r.status !== 200) throw new Error(`batch failed ${r.status}: ${r.raw}`);
  return batchResponseSchema.parse(r.body).results;
};

export const one = async (
  s: TestServer,
  ses: Session,
  c: Ch,
  opts?: { key?: string },
): Promise<ChangeResult> => results(await patchBatch(s, ses, [c], opts))[0]!;

export const history = async (s: TestServer, ses: Session, id: string, q = '') => {
  const r = await call(s.baseUrl, 'GET', `/products/${id}/history${q}`, { cookie: ses.cookie });
  return r;
};

/** Picks products by category/status/shape without depending on seed order. */
export const pick = (
  all: ProductRow[],
  pred: (p: ProductRow) => boolean,
  count = 1,
  skip = 0,
): ProductRow[] => {
  const r = all.filter(pred).slice(skip, skip + count);
  if (r.length < count) throw new Error('seed does not contain enough matching products');
  return r;
};
