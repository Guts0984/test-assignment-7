import { http, HttpResponse } from 'msw';
import {
  canEditCategory,
  computeAdjust,
  matchesFilter,
  type BulkJob,
  type BulkOperation,
  type ProductFilter,
  type SkipItem,
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

  // ---- bulk jobs: progress advances by one chunk per poll, like the real worker -------------------
  type JobItem = {
    id: string;
    state: 'pending' | 'applied' | 'skipped' | 'reverted' | 'revert_skipped';
    reason?: SkipItem['reason'];
    message?: string;
    field?: EditableField;
    version?: number;
    before?: unknown;
  };
  type Job = {
    id: string;
    status: BulkJob['status'];
    filter: ProductFilter;
    operation: BulkOperation;
    items: JobItem[];
    revertedCount: number;
    createdAt: string;
    finishedAt: string | null;
    authorLogin: string | null;
    authorId: string | null;
  };
  const jobs = new Map<string, Job>();
  const jobByKey = new Map<string, string>(); // Idempotency-Key -> job id
  let jobSeq = 0;
  const CHUNK = 250;

  const fieldOf = (op: BulkOperation): EditableField =>
    op.type === 'addTag' || op.type === 'removeTag' ? 'tags' : op.field;
  const skipOf = (j: Job, states: JobItem['state'][]): SkipItem[] =>
    j.items
      .filter((i) => states.includes(i.state))
      .slice(0, 200)
      .map((i) => ({
        productId: i.id,
        sku: find(i.id)?.sku ?? '?',
        reason: i.reason ?? 'invalid',
        message: i.message ?? '',
      }));
  const viewOf = (j: Job): BulkJob => ({
    id: j.id,
    status: j.status,
    filter: j.filter,
    operation: j.operation,
    total: j.items.length,
    processed: j.items.filter((i) => i.state !== 'pending').length,
    applied: j.items.filter(
      (i) => i.state === 'applied' || i.state === 'reverted' || i.state === 'revert_skipped',
    ).length,
    skipped: j.items.filter((i) => i.state === 'skipped').length,
    revertedCount: j.revertedCount,
    author: j.authorId && j.authorLogin ? { id: j.authorId, login: j.authorLogin } : null,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    report: skipOf(j, ['skipped']),
    revertReport: skipOf(j, ['revert_skipped']),
  });

  const applyItem = (j: Job, it: JobItem) => {
    const p = find(it.id);
    if (!p)
      return Object.assign(it, {
        state: 'skipped',
        reason: 'not_found',
        message: 'Product no longer exists',
      });
    if (!me || !canEditCategory(me, p.category))
      return Object.assign(it, {
        state: 'skipped',
        reason: 'forbidden',
        message: 'Product is in a category you cannot edit',
      });
    const op = j.operation;
    const field = fieldOf(op);
    let value: unknown;
    if (op.type === 'set') value = op.value;
    else if (op.type === 'adjust') {
      const r = computeAdjust(op.field, p[op.field], op.mode, op.amount);
      if (!r.ok)
        return Object.assign(it, { state: 'skipped', reason: 'invalid', message: r.message });
      value = r.value;
    } else if (op.type === 'addTag') {
      if (p.tags.includes(op.tag))
        return Object.assign(it, {
          state: 'skipped',
          reason: 'unchanged',
          message: `Already has tag "${op.tag}"`,
        });
      value = [...p.tags, op.tag];
    } else {
      if (!p.tags.includes(op.tag))
        return Object.assign(it, {
          state: 'skipped',
          reason: 'unchanged',
          message: `Does not have tag "${op.tag}"`,
        });
      value = p.tags.filter((t) => t !== op.tag);
    }
    if (JSON.stringify(value) === JSON.stringify(p[field]))
      return Object.assign(it, {
        state: 'skipped',
        reason: 'unchanged',
        message: 'Value already set',
      });
    const [res] = applyBatch([{ id: p.id, field, value, baseVersion: p.versions[field] }], 'bulk');
    if (res!.status === 'ok')
      return Object.assign(it, {
        state: 'applied',
        field,
        version: res!.newVersion,
        before: p[field],
      });
    const msg =
      res!.status === 'invalid' ? res!.issues.map((x) => x.message).join('; ') : res!.status;
    return Object.assign(it, { state: 'skipped', reason: 'invalid', message: msg });
  };

  const revertItem = (it: JobItem) => {
    const p = find(it.id);
    if (!p || !it.field)
      return Object.assign(it, {
        state: 'revert_skipped',
        reason: 'not_found',
        message: 'Product no longer exists',
      });
    if (p.versions[it.field] !== it.version)
      return Object.assign(it, {
        state: 'revert_skipped',
        reason: 'changed_since',
        message: `${it.field} was changed after the job`,
      });
    const [res] = applyBatch(
      [{ id: p.id, field: it.field, value: it.before, baseVersion: p.versions[it.field] }],
      'revert',
    );
    return res!.status === 'ok'
      ? Object.assign(it, { state: 'reverted' })
      : Object.assign(it, {
          state: 'revert_skipped',
          reason: 'invalid',
          message: 'would break a rule',
        });
  };

  const advance = (j: Job) => {
    if (j.status === 'queued') j.status = 'running';
    if (j.status === 'cancelling') {
      j.status = 'cancelled';
      j.finishedAt = new Date().toISOString();
    } else if (j.status === 'running') {
      const pending = j.items.filter((i) => i.state === 'pending').slice(0, CHUNK);
      pending.forEach((i) => applyItem(j, i));
      if (!j.items.some((i) => i.state === 'pending')) {
        j.status = 'done';
        j.finishedAt = new Date().toISOString();
      }
    } else if (j.status === 'reverting') {
      const todo = j.items.filter((i) => i.state === 'applied').slice(0, CHUNK);
      todo.forEach((i) => {
        revertItem(i);
        if (i.state === 'reverted') j.revertedCount++;
      });
      if (!j.items.some((i) => i.state === 'applied')) {
        j.status = 'reverted';
        j.finishedAt = new Date().toISOString();
      }
    }
  };

  const bulkHandlers = [
    http.post('*/api/bulk-jobs/preview', async ({ request }) => {
      if (!me) return unauthorized();
      if (me.role === 'viewer') return err(403, 'forbidden', 'Your role cannot do this');
      const { filter } = (await request.json()) as { filter: ProductFilter };
      const match = products.filter((p) => matchesFilter(p, filter));
      return HttpResponse.json({
        count: match.length,
        editable: match.filter((p) => canEditCategory(me!, p.category)).length,
      });
    }),
    http.post('*/api/bulk-jobs', async ({ request }) => {
      if (!me) return unauthorized();
      if (me.role === 'viewer') return err(403, 'forbidden', 'Your role cannot do this');
      const body = (await request.json()) as { filter: ProductFilter; operation: BulkOperation };
      const key = request.headers.get('idempotency-key');
      state.requests.push({ path: '/bulk-jobs', body, status: 201, ...(key ? { key } : {}) });
      const known = key ? jobByKey.get(`${me.id}:${key}`) : undefined;
      if (known && jobs.has(known))
        return HttpResponse.json(viewOf(jobs.get(known)!), { status: 201 });
      const id = `00000000-0000-4000-8000-9${String(++jobSeq).padStart(11, '0')}`;
      const items = products
        .filter((p) => matchesFilter(p, body.filter))
        .map((p): JobItem => ({ id: p.id, state: 'pending' }));
      const job: Job = {
        id,
        status: 'queued',
        filter: body.filter,
        operation: body.operation,
        items,
        revertedCount: 0,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        authorLogin: me.login,
        authorId: me.id,
      };
      jobs.set(id, job);
      if (key) jobByKey.set(`${me.id}:${key}`, id);
      return HttpResponse.json(viewOf(job), { status: 201 });
    }),
    http.get('*/api/bulk-jobs/:id', ({ params }) => {
      const j = jobs.get(String(params.id));
      if (!me) return unauthorized();
      if (!j) return err(404, 'not_found', 'Job not found');
      advance(j);
      return HttpResponse.json(viewOf(j));
    }),
    http.post('*/api/bulk-jobs/:id/cancel', ({ params }) => {
      const j = jobs.get(String(params.id));
      if (!me) return unauthorized();
      if (!j) return err(404, 'not_found', 'Job not found');
      if (j.status === 'queued') {
        j.status = 'cancelled';
        j.finishedAt = new Date().toISOString();
      } else if (j.status === 'running') j.status = 'cancelling';
      else if (!['cancelling', 'cancelled'].includes(j.status))
        return err(409, 'conflict', `A job that is ${j.status} cannot be cancelled`);
      return HttpResponse.json(viewOf(j));
    }),
    http.post('*/api/bulk-jobs/:id/revert', ({ params }) => {
      const j = jobs.get(String(params.id));
      if (!me) return unauthorized();
      if (!j) return err(404, 'not_found', 'Job not found');
      if (j.status !== 'reverting') {
        if (!['done', 'cancelled', 'failed'].includes(j.status))
          return err(409, 'conflict', `A job that is ${j.status} cannot be reverted`);
        j.status = 'reverting';
        j.finishedAt = null;
      }
      return HttpResponse.json(viewOf(j));
    }),
  ];

  const handlers = [
    ...bulkHandlers,
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
      jobs.clear();
      state.script = [];
      state.requests = [];
      me = null;
    },
    jobCount: () => jobs.size,
    bulkRequests: () => state.requests.filter((r) => r.path === '/bulk-jobs'),
    batchRequests: () => state.requests.filter((r) => r.path === '/products/batch'),
  };
};

export type MockBackend = ReturnType<typeof createMockBackend>;
