import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeResult } from '@catalog/shared';
import { createSyncEngine, type PendingEdit, type SyncDeps, type SyncStatus } from './sync-engine';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edit = (
  n: number,
  field: PendingEdit['field'],
  value: unknown,
  o: Partial<PendingEdit> = {},
): PendingEdit => ({
  id: ID(n),
  field,
  value,
  previous: 'old',
  source: 'edit',
  ...o,
});
const ok = (v: number, value: unknown = 'x'): ChangeResult => ({
  status: 'ok',
  newVersion: v,
  value,
});
const networkError = { retryable: true, message: 'Network error' };

type Call = {
  changes: { id: string; field: string; value: unknown; baseVersion: number }[];
  source: string;
  key: string;
};

const setup = (send: (c: Call) => Promise<ChangeResult[]>, extra: Partial<SyncDeps> = {}) => {
  const versions = new Map<string, number>();
  const log = {
    applied: [] as [PendingEdit, number][],
    conflicts: [] as PendingEdit[],
    rejected: [] as [PendingEdit, string][],
    statuses: [] as SyncStatus[],
    saving: [] as [string[], boolean][],
  };
  let keyN = 0;
  const calls: Call[] = [];
  const deps: SyncDeps = {
    send: (changes, source, key) => {
      const c = { changes, source, key };
      calls.push(c);
      return send(c);
    },
    getVersion: (id, field) => versions.get(`${id}:${field}`) ?? 0,
    onApplied: (e, v) => {
      versions.set(`${e.id}:${e.field}`, v);
      log.applied.push([e, v]);
    },
    onConflict: (e, r) => {
      versions.set(`${e.id}:${e.field}`, r.currentVersion);
      log.conflicts.push(e);
    },
    onRejected: (e, r) => log.rejected.push([e, r.status]),
    onStatus: (s) => log.statuses.push(s),
    onSaving: (keys, on) => log.saving.push([keys, on]),
    newKey: () => `key-${++keyN}`,
    ...extra,
  };
  const engine = createSyncEngine(deps);
  return { engine, calls, log, versions };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('batching and versions', () => {
  it('quick successive edits are sent as ONE batch with the confirmed baseVersion', async () => {
    const { engine, calls, log, versions } = setup(async (c) => c.changes.map((_, i) => ok(i + 1)));
    versions.set(`${ID(1)}:name`, 4);
    engine.enqueue([edit(1, 'name', 'A')]);
    engine.enqueue([edit(2, 'price', '5.00')]);
    const done = engine.flush();
    await vi.runAllTimersAsync();
    await done;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.changes).toEqual([
      { id: ID(1), field: 'name', value: 'A', baseVersion: 4 },
      { id: ID(2), field: 'price', value: '5.00', baseVersion: 0 },
    ]);
    expect(log.applied.map(([, v]) => v)).toEqual([1, 2]);
    expect(engine.status()).toEqual({ state: 'saved', unsaved: 0 });
  });

  it('edits to the same cell are coalesced: only the last value is sent', async () => {
    const { engine, calls } = setup(async (c) => c.changes.map(() => ok(1)));
    engine.enqueue([edit(1, 'name', 'A')]);
    engine.enqueue([edit(1, 'name', 'AB')]);
    engine.enqueue([edit(1, 'name', 'ABC')]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.changes).toHaveLength(1);
    expect(calls[0]!.changes[0]!.value).toBe('ABC');
  });

  it('only one request is in flight; an edit made meanwhile waits and uses the NEW version', async () => {
    let release!: (r: ChangeResult[]) => void;
    const { engine, calls } = setup((c) =>
      calls.length === 1
        ? new Promise((res) => (release = res))
        : Promise.resolve(c.changes.map(() => ok(2))),
    );
    engine.enqueue([edit(1, 'name', 'first')]);
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(1);
    engine.enqueue([edit(1, 'name', 'second')]); // same cell, while the first is in flight
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(1); // not sent yet
    release([ok(1)]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.changes[0]).toMatchObject({ value: 'second', baseVersion: 1 }); // built from the confirmed result
  });

  it('splits at 1000 changes per request', async () => {
    const { engine, calls } = setup(async (c) => c.changes.map(() => ok(1)));
    engine.enqueue(Array.from({ length: 2500 }, (_, i) => edit(i + 1, 'stock', i)));
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls.map((c) => c.changes.length)).toEqual([1000, 1000, 500]);
  });

  it('a different source (paste vs edit) is its own request so history gets the right source', async () => {
    const { engine, calls } = setup(async (c) => c.changes.map(() => ok(1)));
    engine.enqueue([
      edit(1, 'name', 'a'),
      edit(2, 'name', 'b', { source: 'paste' }),
      edit(3, 'name', 'c', { source: 'paste' }),
    ]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls.map((c) => [c.source, c.changes.length])).toEqual([
      ['edit', 1],
      ['paste', 2],
    ]);
  });
});

describe('network failure: retry with the SAME Idempotency-Key', () => {
  it('repeats the batch with an identical key until it gets through, then reports success once', async () => {
    let n = 0;
    const { engine, calls, log } = setup(async (c) => {
      if (++n <= 3) throw networkError;
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    const done = engine.flush();
    await vi.runAllTimersAsync();
    await done;
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1); // same key every time
    expect(
      calls.every((c) => JSON.stringify(c.changes) === JSON.stringify(calls[0]!.changes)),
    ).toBe(true);
    expect(log.applied).toHaveLength(1);
    expect(engine.status().state).toBe('saved');
  });

  it('shows "retrying" with the error while the network is down, and "saved" afterwards', async () => {
    let up = false;
    const { engine, log } = setup(async (c) => {
      if (!up) throw networkError;
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.status()).toMatchObject({
      state: 'retrying',
      unsaved: 1,
      lastError: 'Network error',
    });
    up = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(engine.status()).toEqual({ state: 'saved', unsaved: 0 });
    expect(log.statuses.some((s) => s.state === 'retrying')).toBe(true);
  });

  it('backs off exponentially (not a hot loop) and caps the wait', async () => {
    const times: number[] = [];
    const { engine } = setup(async () => {
      times.push(Date.now());
      throw networkError;
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(times.length).toBeGreaterThan(5);
    expect(times.length).toBeLessThan(25);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(gaps[0]).toBe(500);
    expect(gaps[1]).toBe(1000);
    expect(Math.max(...gaps)).toBe(10_000);
    engine.dispose();
  });

  it('edits made while retrying are queued behind the stuck batch and sent after it, in order', async () => {
    let up = false;
    const { engine, calls } = setup(async (c) => {
      if (!up) throw networkError;
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    await vi.advanceTimersByTimeAsync(1_000);
    engine.enqueue([edit(2, 'name', 'B')]);
    up = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const ok1 = calls.filter((c) => c.changes[0]!.id === ID(1));
    const last = calls[calls.length - 1]!;
    expect(last.changes[0]!.id).toBe(ID(2));
    expect(new Set(ok1.map((c) => c.key)).size).toBe(1);
    expect(last.key).not.toBe(ok1[0]!.key); // a new batch gets a new key
    expect(engine.status().state).toBe('saved');
  });

  it('honours Retry-After (429)', async () => {
    let n = 0;
    const times: number[] = [];
    const { engine } = setup(async (c) => {
      times.push(Date.now());
      if (++n === 1) throw { retryable: true, retryAfterSec: 7, message: 'slow down' };
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(times[1]! - times[0]!).toBe(7_000);
  });

  it('a fatal error (session expired) stops retrying and keeps the edits unsaved', async () => {
    const { engine, calls } = setup(async () => {
      throw { fatal: true, retryable: false, message: 'Session expired' };
    });
    engine.enqueue([edit(1, 'name', 'A')]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(engine.status()).toMatchObject({
      state: 'error',
      unsaved: 1,
      lastError: 'Session expired',
    });
  });

  it('a non-retryable rejection of the whole request reverts those cells and does not block the queue', async () => {
    let n = 0;
    const { engine, log } = setup(async (c) => {
      if (++n === 1) throw { retryable: false, message: 'Bad request' };
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'name', 'bad')]);
    await vi.advanceTimersByTimeAsync(100);
    engine.enqueue([edit(2, 'name', 'good')]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.rejected.map(([e]) => e.id)).toEqual([ID(1)]);
    expect(log.applied.map(([e]) => e.id)).toEqual([ID(2)]);
  });
});

describe('per-change results', () => {
  it('success, conflict and rejection in one response are reported individually; the rest is unaffected', async () => {
    const { engine, log } = setup(async () => [
      ok(1),
      {
        status: 'conflict',
        currentValue: 'theirs',
        currentVersion: 5,
        author: { id: ID(99), login: 'bob' },
        changedAt: '2024-01-01T00:00:00Z',
      },
      { status: 'invalid', issues: [{ code: 'x', message: 'bad' }] },
      { status: 'forbidden', reason: 'no' },
      { status: 'not_found' },
      ok(3),
    ]);
    engine.enqueue([1, 2, 3, 4, 5, 6].map((n) => edit(n, 'stock', n)));
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(log.applied.map(([e]) => e.id)).toEqual([ID(1), ID(6)]);
    expect(log.conflicts.map((e) => e.id)).toEqual([ID(2)]);
    expect(log.rejected.map(([e, s]) => [e.id, s])).toEqual([
      [ID(3), 'invalid'],
      [ID(4), 'forbidden'],
      [ID(5), 'not_found'],
    ]);
    expect(engine.status()).toEqual({ state: 'saved', unsaved: 0 });
  });

  it('a conflict updates the known version, so "keep mine" resends with the server version and wins', async () => {
    let n = 0;
    const { engine, calls, log } = setup(async (c) => {
      if (++n === 1)
        return [
          {
            status: 'conflict',
            currentValue: 'theirs',
            currentVersion: 7,
            author: null,
            changedAt: 'x',
          },
        ];
      return c.changes.map(() => ok(8));
    });
    const e = edit(1, 'name', 'mine');
    engine.enqueue([e]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(log.conflicts).toHaveLength(1);
    engine.requeue(e);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls[1]!.changes[0]).toMatchObject({ value: 'mine', baseVersion: 7 });
    expect(log.applied[0]![1]).toBe(8);
  });

  it('a change bounced only because a sibling failed (rolled_back) is retried once on its own', async () => {
    let n = 0;
    const { engine, calls, log } = setup(async (c) => {
      if (++n === 1)
        return [
          { status: 'rolled_back' },
          { status: 'invalid', issues: [{ code: 'sku_taken', message: 'taken' }] },
        ];
      return c.changes.map(() => ok(1));
    });
    engine.enqueue([edit(1, 'price', '5.00'), edit(1, 'sku', 'TAKEN')]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.changes).toHaveLength(1);
    expect(calls[1]!.changes[0]).toMatchObject({ field: 'price' });
    expect(log.applied.map(([e]) => e.field)).toEqual(['price']);
    expect(log.rejected.map(([e]) => e.field)).toEqual(['sku']);
  });

  it('...but not forever: a second bounce is final', async () => {
    const { engine, log } = setup(async (c) =>
      c.changes.map(() => ({ status: 'rolled_back' }) as ChangeResult),
    );
    engine.enqueue([edit(1, 'price', '5.00')]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(log.rejected).toHaveLength(1);
    expect(engine.status().state).toBe('saved');
  });

  it('a response shorter than the request does not lose edits silently', async () => {
    const { engine, log } = setup(async () => [ok(1)]);
    engine.enqueue([edit(1, 'name', 'a'), edit(2, 'name', 'b')]);
    await vi.runAllTimersAsync();
    await engine.flush();
    expect(log.applied).toHaveLength(1);
    expect(log.rejected).toHaveLength(1);
  });
});

describe('status and saving markers', () => {
  it('marks cells as saving until their result arrives, and counts unsaved', async () => {
    let release!: (r: ChangeResult[]) => void;
    const { engine, log } = setup(() => new Promise((res) => (release = res)));
    engine.enqueue([edit(1, 'name', 'a'), edit(2, 'name', 'b')]);
    expect(engine.status()).toEqual({ state: 'saving', unsaved: 2 });
    await vi.advanceTimersByTimeAsync(50);
    expect(log.saving.some(([keys, on]) => on && keys.length === 2)).toBe(true);
    release([ok(1), ok(1)]);
    await vi.runAllTimersAsync();
    expect(engine.status()).toEqual({ state: 'saved', unsaved: 0 });
    expect(log.saving.some(([keys, on]) => !on && keys.length === 2)).toBe(true);
  });

  it('flush() on an empty queue resolves immediately', async () => {
    const { engine } = setup(async () => []);
    await expect(engine.flush()).resolves.toBeUndefined();
  });

  it('dispose stops everything and releases waiters', async () => {
    const { engine, calls } = setup(async (c) => c.changes.map(() => ok(1)));
    engine.enqueue([edit(1, 'name', 'a')]);
    const done = engine.flush();
    engine.dispose();
    await done;
    await vi.runAllTimersAsync();
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});
