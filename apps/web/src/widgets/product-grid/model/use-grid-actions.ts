'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ClipboardEvent } from 'react';
import type { Me, ProductRow } from '@catalog/shared';
import {
  COLUMNS,
  planCellValues,
  type CellEdit,
  type CellPlan,
  type CellTarget,
  type EditSource,
} from '@/entities/product';
import { buildCopy, planPasteTargets, type CopyPayload } from '@/features/clipboard';
import { planFillTargets } from '@/features/fill-handle';
import { parseTsv, selectionRange, type CellRange, type GridDims } from '@/shared/lib/grid';
import type { AppLocale } from '@/shared/lib/locale';
import { useGridStoreApi } from './grid-context';

export type GridNotice = {
  kind: 'paste' | 'fill' | 'clear';
  applied: number;
  skippedReadOnly: number;
  invalid: number;
  clipped: number;
  unchanged: number;
};

export type ActionCtx = {
  rowAt: (i: number) => ProductRow | undefined;
  dims: GridDims;
  me: Me;
  locale: AppLocale;
  commit: (edits: CellEdit[], source: EditSource) => void;
};

/** What the last in-app copy left behind (typed values survive; the system clipboard only has text). */
let lastCopy: CopyPayload | null = null;
export const resetInternalClipboard = (): void => {
  lastCopy = null;
};

/**
 * Copy, cut, paste, clear, fill: everything that changes MANY cells at once. Each of them produces one
 * `commit` call, so it is one request batch and one undo step.
 */
export const useGridActions = (
  getCtx: () => ActionCtx,
  onNotice?: (n: GridNotice) => void,
  /** Called after a native copy/cut/paste was handled (the grid hands focus back to the active cell). */
  afterClipboard?: () => void,
) => {
  const t = useTranslations();
  const store = useGridStoreApi();

  // label (any supported language) or machine value -> machine value, so a pasted "Books"/"Книги" works
  const selectLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of COLUMNS) {
      if (c.kind !== 'select') continue;
      const group = c.field === 'category' ? 'categories' : 'status';
      for (const o of c.options ?? []) {
        map.set(`${c.field}:${o.toLowerCase()}`, o);
        map.set(`${c.field}:${t(`${group}.${o}`).toLowerCase()}`, o);
      }
    }
    return map;
  }, [t]);

  const label = useCallback(
    (f: 'category' | 'status', v: string) =>
      t(`${f === 'category' ? 'categories' : 'status'}.${v}`),
    [t],
  );

  const finish = useCallback(
    (kind: GridNotice['kind'], plan: CellPlan, clipped: number) => {
      const { commit } = getCtx();
      store.getState().setErrors({
        ...Object.fromEntries(plan.edits.map((e) => [`${e.id}:${e.field}`, null])),
        ...plan.errors,
      });
      if (plan.edits.length)
        commit(plan.edits, kind === 'fill' ? 'fill' : kind === 'paste' ? 'paste' : 'edit');
      onNotice?.({
        kind,
        applied: plan.applied,
        skippedReadOnly: plan.skippedReadOnly,
        invalid: plan.invalid,
        clipped,
        unchanged: plan.unchanged,
      });
    },
    [getCtx, onNotice, store],
  );

  /** True for a real text field (an editor); the grid's own hidden clipboard proxy does not count. */
  const isFieldTarget = (e: ClipboardEvent): boolean => {
    const t = e.target as HTMLElement;
    return !!t.closest('input,select,textarea') && !t.closest('[data-clip-proxy]');
  };

  const copyPayload = useCallback((): CopyPayload | null => {
    const sel = store.getState().selection;
    if (!sel) return null;
    const { rowAt, locale } = getCtx();
    return buildCopy(selectionRange(sel), rowAt, locale, label);
  }, [getCtx, label, store]);

  const onCopy = useCallback(
    (e: ClipboardEvent) => {
      if (store.getState().editing || isFieldTarget(e)) return; // native copy inside an editor
      const payload = copyPayload();
      if (!payload) return;
      e.clipboardData.setData('text/plain', payload.text);
      e.preventDefault();
      lastCopy = payload;
      afterClipboard?.();
    },
    [afterClipboard, copyPayload, store],
  );

  /** Delete / cut: empty the cells that can be emptied (optional fields, tags). Required fields keep their value. */
  const clearRange = useCallback(
    (range: CellRange) => {
      const { rowAt, me, locale } = getCtx();
      const targets: CellTarget[] = [];
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          const col = COLUMNS[c]!;
          if (col.kind === 'tags') targets.push({ row: r, col: c, input: { value: [] } });
          else if (col.nullable) targets.push({ row: r, col: c, input: { value: null } });
        }
      }
      finish('clear', planCellValues(targets, { rowAt, me, locale }), 0);
    },
    [finish, getCtx],
  );

  const onCut = useCallback(
    (e: ClipboardEvent) => {
      if (store.getState().editing || isFieldTarget(e)) return;
      const payload = copyPayload();
      const sel = store.getState().selection;
      if (!payload || !sel) return;
      e.clipboardData.setData('text/plain', payload.text);
      e.preventDefault();
      lastCopy = payload;
      clearRange(selectionRange(sel));
      afterClipboard?.();
    },
    [afterClipboard, clearRange, copyPayload, store],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (store.getState().editing || isFieldTarget(e)) return;
      const sel = store.getState().selection;
      if (!sel) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const matrix = parseTsv(text);
      const { rowAt, dims, me, locale } = getCtx();
      const raw = lastCopy && lastCopy.text === text ? lastCopy.raw : null;
      const area = planPasteTargets(
        matrix,
        selectionRange(sel),
        dims,
        (i, j, cellText, targetCol) => {
          const src = raw?.[i]?.[j];
          const col = COLUMNS[targetCol]!;
          // Same kind of column: keep the exact typed value (no locale round trip). Otherwise parse the text.
          if (src && COLUMNS.find((c) => c.field === src.field)?.kind === col.kind)
            return { value: src.value };
          if (col.kind === 'select' && cellText.trim() !== '') {
            const hit = selectLookup.get(`${col.field}:${cellText.trim().toLowerCase()}`);
            return { text: hit ?? cellText };
          }
          return { text: cellText };
        },
      );
      afterClipboard?.();
      if (area.targets.length === 0) return;
      finish('paste', planCellValues(area.targets, { rowAt, me, locale }), area.clipped);
      if (area.area) {
        store.getState().setSelection({
          active: sel.active,
          anchor: { row: area.area.r1, col: area.area.c1 },
          focus: { row: area.area.r2, col: area.area.c2 },
        });
      }
    },
    [afterClipboard, finish, getCtx, selectLookup, store],
  );

  /** Fill from `source` to `extended`: copy or continue a numeric/date/text series. One action. */
  const applyFill = useCallback(
    (source: CellRange, extended: CellRange, increment: boolean) => {
      const { rowAt, me, locale } = getCtx();
      const targets = planFillTargets({
        source,
        extended,
        increment,
        valueAt: (r, c) => rowAt(r)?.[COLUMNS[c]!.field] ?? null,
      });
      if (targets.length === 0) return;
      finish('fill', planCellValues(targets, { rowAt, me, locale }), 0);
      const sel = store.getState().selection;
      if (sel) {
        store.getState().setSelection({
          active: sel.active,
          anchor: { row: extended.r1, col: extended.c1 },
          focus: { row: extended.r2, col: extended.c2 },
        });
      }
    },
    [finish, getCtx, store],
  );

  /** Text the proxy field must hold so that a native Ctrl+C copies the selection. */
  const copyText = useCallback((): string | null => copyPayload()?.text ?? null, [copyPayload]);

  return { onCopy, onCut, onPaste, clearRange, applyFill, copyText };
};
