import { http, HttpResponse } from 'msw';
import {
  canEditCategory,
  fieldValueSchemas,
  validateProductState,
  type ChangeResult,
  type EditableField,
  type HistoryEntry,
  type Me,
  type ProductRow,
  type ProductState,
} from '@catalog/shared';
import { makeProducts } from './data';

export type Behaviour = 'ok' | 'network-error' | 'apply-then-network-error' | 'unavailable';

type Entry = HistoryEntry & { fieldVersion: number };

/**
 * An in-memory API with the same rules as the real one: per-field versions, conflicts that name the
 * author, atomic changes per product, cross-field validation, Idempotency-Key replay and per-role permissions.
 * Failure injection (`script`) lets tests cut the network at the worst moment.
 */
export const createMockBackend = (size = 2000) => {
  let products: ProductRow[] = makeProducts(size);
  let history: Entry[] = [];
  let nextHistoryId = 1;
  let me: Me | null = null;
  const idem = new Map<string, { hash: string; response: { results: ChangeResult[] } }>();
  const state = {
    script: [] as Behaviour[],
    requests: [] as { path: string; key?: string; body: unknown; status: number }[],
    /** Other people who edited, so conflicts name them. */
    otherUser: { id: '33333333-3333-4333-8333-333333333333', login: 'bob' },
  };

  const find = (id: string) => products.find((p) => p.id === id);
  const stateOf = (p: ProductRow): ProductState => ({
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: p.price,
    oldPrice: p.oldPrice,
    stock: p.stock,
    status: p.status,
    tags: p.tags,
    arrivalDate: p.arrivalDate,
  });
  const log = (
    p: ProductRow,
    field: EditableField,
    oldValue: unknown,
    newValue: unknown,
    version: number,
    source: HistoryEntry['source'],
    by: { id: string; login: string },
  ) =>
    history.push({
      id: String(nextHistoryId++),
      productId: p.id,
      field,
      oldValue,
      newValue,
      version,
      fieldVersion: version,
      source,
      author: by,
      jobId: null,
      createdAt: new Date().toISOString(),
    });

  const authorOf = (id: string, field: EditableField) => {
    const last = [...history].reverse().find((h) => h.productId === id && h.field === field);
    return last?.author ?? null;
  };

  const applyBatch = (
    changes: { id: string; field: EditableField; value: unknown; baseVersion: number }[],
    source: HistoryEntry['source'],
  ): ChangeResult[] => {
    const results: ChangeResult[] = new Array(changes.length);
    const groups = new Map<string, number[]>();
    changes.forEach((c, i) => groups.set(c.id, [...(groups.get(c.id) ?? []), i]));
    for (const [id, idxs] of groups) {
      const p = find(id);
      if (!p) {
        idxs.forEach((i) => (results[i] = { status: 'not_found' }));
        continue;
      }
      if (!me || !canEditCategory(me, p.category)) {
        idxs.forEach(
          (i) =>
            (results[i] = {
              status: 'forbidden',
              reason: 'Product is in a category you cannot edit',
            }),
        );
        continue;
      }
      const toApply: number[] = [];
      let failed = false;
      for (const i of idxs) {
        const c = changes[i]!;
        const parsed = fieldValueSchemas[c.field].safeParse(c.value);
        if (!parsed.success) {
          results[i] = {
            status: 'invalid',
            issues: [{ code: 'invalidValue', field: c.field, message: 'invalid' }],
          };
          failed = true;
          continue;
        }
        if (JSON.stringify(parsed.data) === JSON.stringify(p[c.field])) {
          results[i] = { status: 'ok', newVersion: p.versions[c.field], value: p[c.field] };
          continue;
        }
        if (c.baseVersion !== p.versions[c.field]) {
          results[i] = {
            status: 'conflict',
            currentValue: p[c.field],
            currentVersion: p.versions[c.field],
            author: authorOf(id, c.field),
            changedAt: new Date().toISOString(),
          };
          continue;
        }
        toApply.push(i);
      }
      if (failed) {
        toApply.forEach((i) => (results[i] = { status: 'rolled_back' }));
        continue;
      }
      const next = { ...stateOf(p) } as Record<string, unknown>;
      toApply.forEach((i) => (next[changes[i]!.field] = changes[i]!.value));
      const issues = validateProductState(next as unknown as ProductState);
      if (issues.length) {
        toApply.forEach(
          (i) =>
            (results[i] = {
              status: 'invalid',
              issues: issues.map((x) => ({ code: x.code, message: x.message, field: x.field })),
            }),
        );
        continue;
      }
      let row = p;
      for (const i of toApply) {
        const c = changes[i]!;
        const v = row.versions[c.field] + 1;
        log(row, c.field, row[c.field], c.value, v, source, me);
        row = {
          ...row,
          [c.field]: c.value,
          versions: { ...row.versions, [c.field]: v },
        } as ProductRow;
        results[i] = { status: 'ok', newVersion: v, value: c.value };
      }
      products = products.map((x) => (x.id === id ? row : x));
    }
    return results;
  };

  const unauthorized = () =>
    HttpResponse.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  const err = (status: number, code: string, message: string, details?: unknown) =>
    HttpResponse.json({ error: { code, message, details } }, { status });

  const handlers = [
    http.get('*/api/products', () => {
      state.requests.push({ path: '/products', body: null, status: 200 });
      return me ? HttpResponse.json({ products }) : unauthorized();
    }),

    http.patch('*/api/products/batch', async ({ request }) => {
      const body = (await request.json()) as {
        changes: { id: string; field: EditableField; value: unknown; baseVersion: number }[];
        source?: HistoryEntry['source'];
      };
      const key = request.headers.get('idempotency-key') ?? undefined;
      const record = (status: number) =>
        state.requests.push({ path: '/products/batch', key, body, status });
      if (!me) {
        record(401);
        return unauthorized();
      }
      if (me.role === 'viewer') {
        record(403);
        return err(403, 'forbidden', 'Your role cannot do this');
      }
      const behaviour = state.script.shift() ?? 'ok';
      if (behaviour === 'network-error') {
        record(0);
        return HttpResponse.error();
      }
      if (behaviour === 'unavailable') {
        record(503);
        return err(503, 'unavailable', 'Database unavailable');
      }
      const hash = JSON.stringify(body);
      let response: { results: ChangeResult[] };
      const seen = key ? idem.get(key) : undefined;
      if (seen) {
        if (seen.hash !== hash) {
          record(422);
          return err(
            422,
            'idempotency_key_reused',
            'Idempotency-Key was already used with a different request body',
          );
        }
        response = seen.response; // replay: applied once, same answer
      } else {
        response = { results: applyBatch(body.changes, body.source ?? 'edit') };
        if (key) idem.set(key, { hash, response });
      }
      if (behaviour === 'apply-then-network-error') {
        record(0);
        return HttpResponse.error(); // the server DID apply it; the client never learns
      }
      record(200);
      return HttpResponse.json(response, {
        headers: seen ? { 'idempotent-replayed': 'true' } : {},
      });
    }),

    http.get('*/api/products/:id/history', ({ params }) => {
      const entries = history
        .filter((h) => h.productId === params.id)
        .reverse()
        .map(({ fieldVersion: _v, ...h }) => h);
      return me ? HttpResponse.json({ entries }) : unauthorized();
    }),

    http.post('*/api/history/:changeId/restore', async ({ params, request }) => {
      if (!me) return unauthorized();
      const { baseVersion } = (await request.json()) as { baseVersion: number };
      const entry = history.find((h) => h.id === params.changeId);
      if (!entry) return err(404, 'not_found', 'History entry not found');
      const [res] = applyBatch(
        [{ id: entry.productId, field: entry.field, value: entry.oldValue, baseVersion }],
        'restore',
      );
      if (res!.status === 'ok') return HttpResponse.json({ result: res });
      if (res!.status === 'conflict')
        return err(409, 'conflict', 'The field changed since you loaded it', res);
      if (res!.status === 'forbidden') return err(403, 'forbidden', 'Forbidden');
      return err(400, 'validation_failed', 'Restoring this value is not allowed', res);
    }),
  ];

  return {
    handlers,
    state,
    get products() {
      return products;
    },
    signIn: (m: Me | null) => {
      me = m;
    },
    /** Someone else changed a cell (another browser): version bumps, history names them. */
    externalEdit: (id: string, field: EditableField, value: unknown) => {
      const p = find(id)!;
      const v = p.versions[field] + 1;
      log(p, field, p[field], value, v, 'edit', state.otherUser);
      products = products.map((x) =>
        x.id === id
          ? ({ ...x, [field]: value, versions: { ...x.versions, [field]: v } } as ProductRow)
          : x,
      );
    },
    reset: () => {
      products = makeProducts(size);
      history = [];
      nextHistoryId = 1;
      idem.clear();
      state.script = [];
      state.requests = [];
      me = null;
    },
    batchRequests: () => state.requests.filter((r) => r.path === '/products/batch'),
  };
};

export type MockBackend = ReturnType<typeof createMockBackend>;
