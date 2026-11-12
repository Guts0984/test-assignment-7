import type { ChangeResult, ChangeSource, EditableField } from '@catalog/shared';

export type SyncSource = Extract<ChangeSource, 'edit' | 'paste' | 'fill' | 'undo'>;

/** An edit that has already been applied to the screen and now has to reach the server. */
export type PendingEdit = {
  id: string;
  field: EditableField;
  /** What the cell shows now (the optimistic value). */
  value: unknown;
  /** What it showed before, so a rejection can put it back. */
  previous: unknown;
  source: SyncSource;
  /** How many times a valid edit was bounced back only because a sibling in its product failed. */
  bounces?: number;
};

export type SyncState = 'saved' | 'saving' | 'retrying' | 'error';
export type SyncStatus = { state: SyncState; unsaved: number; lastError?: string };

export type SendError = {
  retryable: boolean;
  retryAfterSec?: number;
  fatal?: boolean;
  message: string;
};

export type SyncDeps = {
  /** One HTTP call. Resolve with per-change results; REJECT with `SendError` for anything that is not a response body. */
  send: (
    changes: { id: string; field: EditableField; value: unknown; baseVersion: number }[],
    source: SyncSource,
    key: string,
  ) => Promise<ChangeResult[]>;
  /** Confirmed server version of a cell at the moment of sending. */
  getVersion: (id: string, field: EditableField) => number;
  onApplied: (e: PendingEdit, newVersion: number, value: unknown) => void;
  onConflict: (e: PendingEdit, r: Extract<ChangeResult, { status: 'conflict' }>) => void;
  onRejected: (e: PendingEdit, r: Exclude<ChangeResult, { status: 'ok' | 'conflict' }>) => void;
  /** After ALL results of one response were reported: lets the caller apply them to the screen in ONE pass. */
  onResultsHandled?: () => void;
  onStatus: (s: SyncStatus) => void;
  onSaving: (keys: string[], saving: boolean) => void;
  newKey: () => string;
  /** Timers are injected so tests control time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  batchSize?: number;
  debounceMs?: number;
  backoffMs?: (attempt: number) => number;
};

const keyOf = (e: { id: string; field: EditableField }) => `${e.id}:${e.field}`;

export type SyncEngine = {
  enqueue: (edits: PendingEdit[]) => void;
  /** Sends everything that is queued and resolves when the queue is empty (or stopped by a fatal error). */
  flush: () => Promise<void>;
  status: () => SyncStatus;
  /** Re-queue an edit whose conflict the user resolved with "mine". */
  requeue: (e: PendingEdit) => void;
  dispose: () => void;
};

/**
 * Optimistic-update queue.
 *  - edits to the same cell are coalesced (last one wins) while they wait
 *  - one request in flight at a time, so versions are known when the next batch is built
 *  - a request that fails for network reasons is repeated with the SAME Idempotency-Key until it
 *    gets through (if the first attempt did reach the server, the server returns the stored response)
 *  - per-change results: ok / conflict / rejected are reported individually; the rest is unaffected
 */
export const createSyncEngine = (deps: SyncDeps): SyncEngine => {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const batchSize = deps.batchSize ?? 1000;
  const debounceMs = deps.debounceMs ?? 40;
  const backoff = deps.backoffMs ?? ((n) => Math.min(500 * 2 ** n, 10_000));

  const queued = new Map<string, PendingEdit>();
  let inflight: { key: string; edits: PendingEdit[]; source: SyncSource } | null = null;
  let debounceTimer: unknown = null;
  // The retry back-off wait is separate from the debounce timer: enqueueing an edit while a request is
  // being retried must not cancel the back-off (that would leave the retry loop waiting forever).
  let retryTimer: unknown = null;
  let wakeRetry: (() => void) | null = null;
  let running: Promise<void> | null = null;
  let error: string | undefined;
  let retrying = false;
  let stopped = false;
  let disposed = false;
  const waiters: (() => void)[] = [];

  const unsaved = () => queued.size + (inflight?.edits.length ?? 0);
  const status = (): SyncStatus => ({
    state:
      error && !retrying
        ? 'error'
        : retrying
          ? 'retrying'
          : inflight
            ? 'saving'
            : queued.size > 0
              ? 'saving'
              : 'saved',
    unsaved: unsaved(),
    ...(error ? { lastError: error } : {}),
  });
  const emit = () => deps.onStatus(status());

  const settle = () => {
    if (unsaved() === 0 || stopped) while (waiters.length) waiters.shift()!();
  };

  const nextBatch = (): { edits: PendingEdit[]; source: SyncSource } | null => {
    const first = queued.values().next().value as PendingEdit | undefined;
    if (!first) return null;
    const edits: PendingEdit[] = [];
    // One request has one source ("paste", "fill"...): take the leading run of that source, in order.
    for (const e of queued.values()) {
      if (e.source !== first.source) break;
      edits.push(e);
      if (edits.length >= batchSize) break;
    }
    for (const e of edits) queued.delete(keyOf(e));
    return { edits, source: first.source };
  };

  /**
   * `e` was refused while a NEWER edit of the same cell is already waiting: that newer edit's fallback must be
   * what the server really has (`e.previous`), not the refused value it was typed over.
   */
  const reject = (e: PendingEdit, r: Exclude<ChangeResult, { status: 'ok' | 'conflict' }>) => {
    const waiting = queued.get(keyOf(e));
    if (waiting) queued.set(keyOf(e), { ...waiting, previous: e.previous });
    deps.onRejected(e, r);
  };

  const handleResults = (b: { edits: PendingEdit[] }, results: ChangeResult[]) => {
    deps.onSaving(b.edits.map(keyOf), false);
    b.edits.forEach((e, i) => {
      const r = results[i];
      if (!r) return reject(e, { status: 'rolled_back' });
      switch (r.status) {
        case 'ok':
          return deps.onApplied(e, r.newVersion, r.value);
        case 'conflict':
          return deps.onConflict(e, r);
        case 'rolled_back':
          // Valid on its own, bounced only because another change of the same product was refused. Try once more alone.
          if ((e.bounces ?? 0) < 1 && !queued.has(keyOf(e))) {
            queued.set(keyOf(e), { ...e, bounces: (e.bounces ?? 0) + 1 });
            deps.onSaving([keyOf(e)], true);
            return;
          }
          return reject(e, r);
        default:
          return reject(e, r);
      }
    });
    deps.onResultsHandled?.();
  };

  const pump = async (): Promise<void> => {
    while (!disposed && !stopped) {
      if (!inflight) {
        const nb = nextBatch();
        if (!nb) break;
        inflight = { key: deps.newKey(), edits: nb.edits, source: nb.source };
        deps.onSaving(nb.edits.map(keyOf), true);
        emit();
      }
      const b = inflight;
      let attempt = 0;
      for (;;) {
        if (disposed) return;
        try {
          const results = await deps.send(
            b.edits.map((e) => ({
              id: e.id,
              field: e.field,
              value: e.value,
              baseVersion: deps.getVersion(e.id, e.field),
            })),
            b.source,
            b.key, // same key on every retry of this batch
          );
          retrying = false;
          error = undefined;
          inflight = null;
          handleResults(b, results);
          break;
        } catch (raw) {
          const e = raw as Partial<SendError>;
          if (e.fatal) {
            // e.g. session expired: stop, keep the edits queued, tell the user.
            retrying = false;
            error = e.message ?? 'Request failed';
            stopped = true;
            emit();
            settle();
            return;
          }
          if (e.retryable === false) {
            // The server will never accept this batch (client bug / validation): drop it, revert the cells, carry on.
            retrying = false;
            error = e.message ?? 'Request rejected';
            inflight = null;
            deps.onSaving(b.edits.map(keyOf), false);
            for (const ed of b.edits) reject(ed, { status: 'rolled_back' });
            deps.onResultsHandled?.();
            break;
          }
          retrying = true;
          error = e.message ?? 'Network error';
          emit();
          const wait = e.retryAfterSec ? e.retryAfterSec * 1000 : backoff(attempt++);
          await new Promise<void>((res) => {
            wakeRetry = res;
            retryTimer = setTimer(() => res(), wait);
          });
          wakeRetry = null;
          retryTimer = null;
        }
      }
      emit();
    }
    emit();
    settle();
  };

  const run = (): Promise<void> => {
    if (!running) {
      running = pump().finally(() => {
        running = null;
        // edits that arrived while we were finishing
        if (!disposed && !stopped && queued.size > 0) void run();
      });
    }
    return running;
  };

  const schedule = () => {
    if (debounceTimer !== null) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void run();
    }, debounceMs);
  };

  return {
    enqueue: (edits) => {
      if (disposed || edits.length === 0) return;
      stopped = false;
      for (const e of edits) {
        // Coalesce: last write wins - but the value to fall back to on a refusal is what the SERVER has, i.e. the
        // `previous` of the FIRST waiting edit (100 -> 200 -> 300: if 300 is refused the cell goes back to 100,
        // not to the 200 that was never sent).
        const waiting = queued.get(keyOf(e));
        queued.set(keyOf(e), waiting ? { ...e, previous: waiting.previous } : e);
      }
      deps.onSaving(edits.map(keyOf), true);
      emit();
      schedule();
    },
    requeue: (e) => {
      stopped = false;
      queued.set(keyOf(e), { ...e, bounces: 0 });
      deps.onSaving([keyOf(e)], true);
      emit();
      schedule();
    },
    flush: () => {
      if (debounceTimer !== null) {
        clearTimer(debounceTimer);
        debounceTimer = null;
      }
      if (unsaved() === 0) return Promise.resolve();
      const done = new Promise<void>((res) => waiters.push(res));
      void run();
      return done;
    },
    status,
    dispose: () => {
      disposed = true;
      if (debounceTimer !== null) clearTimer(debounceTimer);
      if (retryTimer !== null) clearTimer(retryTimer);
      wakeRetry?.();
      while (waiters.length) waiters.shift()!();
    },
  };
};
