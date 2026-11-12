'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditableField, ProductRow } from '@catalog/shared';
import {
  cellKey,
  getCachedRows,
  patchCachedRows,
  patchBatch,
  type CellEdit,
  type CellError,
  type ConflictInfo,
  type EditSource,
  type CommitOptions,
} from '@/entities/product';
import {
  discardChange,
  emptyStack,
  pushAction,
  redo as redoStack,
  undo as undoStack,
  type UndoStack,
} from '@/shared/lib/undo';
import { cellErrorFromResult } from '../lib/result-error';
import { toSendError } from '../lib/send-error';
import {
  createSyncEngine,
  type SyncDeps,
  type PendingEdit,
  type SyncEngine,
  type SyncStatus,
  type SyncSource,
} from '../lib/sync-engine';

/** What the grid must be told about; implemented by the grid's store, kept abstract so features stay independent of widgets. */
export type EditUi = {
  setSaving: (patch: Record<string, boolean>) => void;
  setConflicts: (patch: Record<string, ConflictInfo | null>) => void;
  setErrors: (patch: Record<string, CellError | null>) => void;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k${Date.now()}${Math.random().toString(36).slice(2)}`;

export type ProductEdits = {
  status: SyncStatus;
  canUndo: boolean;
  canRedo: boolean;
  commit: (edits: CellEdit[], source: EditSource, opts?: CommitOptions) => void;
  undo: () => void;
  redo: () => void;
  resolveConflict: (id: string, field: EditableField, choice: 'mine' | 'theirs') => void;
  flush: () => Promise<void>;
};

/**
 * Optimistic editing for the product table: applies edits to the TanStack Query cache immediately,
 * queues them for the server (batched, idempotent, retried), reports per-cell results to the grid,
 * and keeps the last 50 actions for Ctrl+Z / Ctrl+Shift+Z.
 */
export type SyncOptions = Partial<Pick<SyncDeps, 'backoffMs' | 'debounceMs'>>;

export const useProductEdits = (ui: EditUi, options: SyncOptions = {}): ProductEdits => {
  const qc = useQueryClient();
  const uiRef = useRef(ui);
  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  const [status, setStatus] = useState<SyncStatus>({ state: 'saved', unsaved: 0 });
  const [stack, setStack] = useState<UndoStack>(emptyStack);
  const stackRef = useRef<UndoStack>(emptyStack);
  const conflicts = useRef(new Map<string, { edit: PendingEdit; theirs: unknown }>());
  const rowsIndex = useRef<{ rows: ProductRow[] | undefined; map: Map<string, ProductRow> }>({
    rows: undefined,
    map: new Map(),
  });

  const rowsById = useCallback(() => {
    const rows = getCachedRows(qc);
    if (rowsIndex.current.rows !== rows)
      rowsIndex.current = { rows, map: new Map((rows ?? []).map((r) => [r.id, r])) };
    return rowsIndex.current.map;
  }, [qc]);

  // Results of one response are collected and written to the cache ONCE: a 500-cell fill would otherwise
  // rebuild the 2000-row table 500 times (one pass per confirmed cell).
  const patches = useRef<Parameters<typeof patchCachedRows>[1][number][]>([]);
  const errorPatch = useRef<Record<string, CellError | null>>({});
  const flushPatches = useCallback(() => {
    if (patches.current.length > 0) {
      const batch = patches.current;
      patches.current = [];
      patchCachedRows(qc, batch);
    }
    if (Object.keys(errorPatch.current).length > 0) {
      const batch = errorPatch.current;
      errorPatch.current = {};
      uiRef.current.setErrors(batch);
    }
  }, [qc]);

  const engineRef = useRef<SyncEngine | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const engine = createSyncEngine({
      ...optionsRef.current,
      newKey,
      send: async (changes, source, key) => {
        try {
          return (await patchBatch({ changes, source }, key)).results;
        } catch (e) {
          throw toSendError(e);
        }
      },
      getVersion: (id, field) => rowsById().get(id)?.versions[field] ?? 0,
      onSaving: (keys, on) => uiRef.current.setSaving(Object.fromEntries(keys.map((k) => [k, on]))),
      onStatus: setStatus,
      onApplied: (e, newVersion, value) => {
        const current = rowsById().get(e.id)?.[e.field];
        // If the person already typed something newer into this cell, keep theirs; only the version advances.
        const keepLocal = !same(current, e.value);
        patches.current.push({
          id: e.id,
          field: e.field,
          version: newVersion,
          ...(keepLocal ? {} : { value }),
        });
        errorPatch.current[cellKey(e.id, e.field)] = null;
      },
      onConflict: (e, r) => {
        const key = cellKey(e.id, e.field);
        // The server's version becomes our baseVersion, so "keep mine" can be re-sent and win.
        patches.current.push({ id: e.id, field: e.field, version: r.currentVersion });
        conflicts.current.set(key, { edit: e, theirs: r.currentValue });
        uiRef.current.setConflicts({
          [key]: {
            mine: e.value,
            theirs: r.currentValue,
            theirsVersion: r.currentVersion,
            author: r.author?.login ?? null,
          },
        });
      },
      onRejected: (e, r) => {
        // It never happened: take it off the undo stack (an undo/redo that is refused is not on it).
        if (e.source !== 'undo') {
          const next = discardChange(stackRef.current, {
            id: e.id,
            field: e.field,
            after: e.value,
          });
          if (next !== stackRef.current) {
            stackRef.current = next;
            setStack(next);
          }
        }
        const current = rowsById().get(e.id)?.[e.field];
        if (same(current, e.value))
          patches.current.push({ id: e.id, field: e.field, value: e.previous });
        errorPatch.current[cellKey(e.id, e.field)] = cellErrorFromResult(e.field, r);
      },
      onResultsHandled: flushPatches,
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [qc, rowsById, flushPatches]);

  // Leaving the page with unsaved edits asks for confirmation.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if ((engineRef.current?.status().unsaved ?? 0) > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const commit: ProductEdits['commit'] = useCallback(
    (edits, source, opts) => {
      const index = rowsById();
      const pending: PendingEdit[] = [];
      const undoChanges: { id: string; field: EditableField; before: unknown; after: unknown }[] =
        [];
      const heldBack: Record<string, CellError> = {};
      for (const e of edits) {
        const row = index.get(e.id);
        if (!row) continue;
        // A cell with an unresolved conflict still SHOWS the user's own value, but the server holds someone
        // else's. Only a deliberate typed edit (`overwriteConflicts`) may replace it; undo/redo, paste, fill and Delete must not
        // silently overwrite the other person's value (the person has not chosen between the two yet).
        if (!opts?.overwriteConflicts && conflicts.current.has(cellKey(e.id, e.field))) {
          heldBack[cellKey(e.id, e.field)] = { code: 'conflictPending', field: e.field };
          continue;
        }
        const previous = row[e.field];
        if (same(previous, e.value)) continue;
        pending.push({
          id: e.id,
          field: e.field,
          value: e.value,
          previous,
          source: source as SyncSource,
        });
        undoChanges.push({ id: e.id, field: e.field, before: previous, after: e.value });
      }
      if (Object.keys(heldBack).length) uiRef.current.setErrors(heldBack);
      if (pending.length === 0) return;
      patchCachedRows(
        qc,
        pending.map((p) => ({ id: p.id, field: p.field, value: p.value })),
      );
      // A new edit supersedes a conflict marker on the same cell.
      const cleared: Record<string, null> = {};
      for (const p of pending) {
        const k = cellKey(p.id, p.field);
        if (conflicts.current.delete(k)) cleared[k] = null;
      }
      if (Object.keys(cleared).length) uiRef.current.setConflicts(cleared);
      if (source !== 'undo') {
        stackRef.current = pushAction(stackRef.current, { changes: undoChanges });
        setStack(stackRef.current);
      }
      engineRef.current?.enqueue(pending);
    },
    [qc, rowsById],
  );

  const undo = useCallback(() => {
    const r = undoStack(stackRef.current);
    if (!r) return;
    stackRef.current = r.stack;
    setStack(r.stack);
    commit(
      r.action.changes.map((c) => ({ id: c.id, field: c.field, value: c.before })),
      'undo',
    );
  }, [commit]);

  const redo = useCallback(() => {
    const r = redoStack(stackRef.current);
    if (!r) return;
    stackRef.current = r.stack;
    setStack(r.stack);
    commit(
      r.action.changes.map((c) => ({ id: c.id, field: c.field, value: c.after })),
      'undo',
    );
  }, [commit]);

  const resolveConflict: ProductEdits['resolveConflict'] = useCallback(
    (id, field, choice) => {
      const key = cellKey(id, field);
      const c = conflicts.current.get(key);
      if (!c) return;
      conflicts.current.delete(key);
      if (choice === 'mine') {
        engineRef.current?.requeue(c.edit); // re-sent with the server's version as baseVersion
      } else {
        // The server value wins: show it. The version already advanced when the conflict arrived.
        patchCachedRows(qc, [{ id, field, value: c.theirs }]);
      }
      uiRef.current.setConflicts({ [key]: null });
    },
    [qc],
  );

  return {
    status,
    canUndo: stack.undoDepth > 0,
    canRedo: stack.redoDepth > 0,
    commit,
    undo,
    redo,
    resolveConflict,
    flush: () => engineRef.current?.flush() ?? Promise.resolve(),
  };
};
