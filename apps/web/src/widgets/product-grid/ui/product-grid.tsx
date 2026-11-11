'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { EditableField, Me, ProductRow } from '@catalog/shared';
import {
  COLUMNS,
  canEditRow,
  editText,
  type CellEdit,
  type CellError,
  type EditSource,
  type TableQuery,
} from '@/entities/product';
import { planCellEdit } from '@/features/edit-cell';
import {
  advance,
  arrow,
  arrowToEdge,
  computeWindow,
  end,
  home,
  page,
  rangeSize,
  reclamp,
  rowsToMount,
  scrollTopToReveal,
  selectAll,
  selectionRange,
  single,
  type CellPos,
  type CellRange,
  type Dir,
  type Selection,
} from '@/shared/lib/grid';
import type { AppLocale } from '@/shared/lib/locale';
import { GridStoreProvider, useGrid, useGridStoreApi } from '../model/grid-context';
import type { GridStore } from '../model/grid-store';
import { cellKey } from '../model/grid-store';
import { resolveKey, type GridAction } from '../lib/keymap';
import { useGridActions, type GridNotice } from '../model/use-grid-actions';
import { FillHandle, FillPreview, rangeBox } from '@/features/fill-handle';
import { cellDomId } from './cell';
import { GridHeader, HEADER_HEIGHT } from './header';
import { GridRow, ROW_HEIGHT } from './row';

export type GridCommand =
  Extract<GridAction, { type: 'undo' | 'redo' | 'history' }> | { type: 'conflict' };

export type ProductGridProps = {
  rows: readonly ProductRow[];
  /** Ids in display order. Selection indices refer to this list. */
  order: readonly string[];
  me: Me;
  locale: AppLocale;
  sort: TableQuery['sort'];
  onSort: (field: EditableField) => void;
  renderColumnFilter?: (field: EditableField) => ReactNode;
  /** Applies edits (optimistically) and queues them for the server. */
  commit: (edits: CellEdit[], source: EditSource) => void;
  /** Clipboard / undo / clear are implemented by features; the grid forwards the intent. */
  onCommand?: (cmd: GridCommand, selection: Selection) => void;
  /** Reports what a paste / fill / clear did (applied, skipped, invalid) for the page to announce. */
  onNotice?: (n: GridNotice) => void;
  store?: GridStore;
  initialViewportHeight?: number;
  /** Slot rendered inside the scroll area after the rows (fill handle overlay etc.). */
  overlay?: ReactNode;
  className?: string;
};

export type { GridNotice };

export const ProductGrid = (props: ProductGridProps) => (
  <GridStoreProvider store={props.store}>
    <GridInner {...props} />
  </GridStoreProvider>
);

const GridInner = ({
  rows,
  order,
  me,
  locale,
  sort,
  onSort,
  renderColumnFilter,
  commit,
  onCommand,
  onNotice,
  initialViewportHeight = 600,
  overlay,
  className,
}: ProductGridProps) => {
  const t = useTranslations();
  const store = useGridStoreApi();
  const gridId = useId().replace(/:/g, '');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(initialViewportHeight);
  const focusRequested = useRef(false);

  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  // Handlers handed to every row must keep their identity when data changes, or memo cannot skip rows.
  // They read the latest data through this ref instead of closing over it.
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  });
  const latest = useRef({
    rowsById,
    order,
    me,
    locale,
    commit,
    dims: { rows: order.length, cols: COLUMNS.length },
  });
  const dims = useMemo(() => ({ rows: order.length, cols: COLUMNS.length }), [order.length]);
  useLayoutEffect(() => {
    latest.current = { rowsById, order, me, locale, commit, dims };
  });
  const widths = useGrid((s) => s.colWidths);
  const activeRow = useGrid((s) => s.selection?.active.row ?? -1);
  const selection = useGrid((s) => s.selection);
  const isEditing = useGrid((s) => s.editing !== null);

  // ---- virtualization -------------------------------------------------------
  const win = useMemo(
    () =>
      computeWindow({
        scrollTop,
        viewportHeight: Math.max(0, viewportHeight - HEADER_HEIGHT),
        rowHeight: ROW_HEIGHT,
        rowCount: order.length,
        overscan: 6,
      }),
    [scrollTop, viewportHeight, order.length],
  );
  const mounted = useMemo(
    () => rowsToMount(win, [activeRow], order.length),
    [win, activeRow, order.length],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientHeight > 0) setViewportHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lastWindowKey = useRef('');
  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Re-render only when the set of mounted rows would actually change (a few times per second, not per pixel).
    const w = computeWindow({
      scrollTop: el.scrollTop,
      viewportHeight: Math.max(0, viewportHeight - HEADER_HEIGHT),
      rowHeight: ROW_HEIGHT,
      rowCount: order.length,
      overscan: 6,
    });
    const key = `${w.start}:${w.end}`;
    if (key !== lastWindowKey.current) {
      lastWindowKey.current = key;
      setScrollTop(el.scrollTop);
    }
  }, [viewportHeight, order.length]);

  // ---- selection housekeeping ----------------------------------------------
  useEffect(() => {
    const cur = store.getState().selection;
    if (!cur) return;
    const next = reclamp(cur, dims);
    if (next !== cur) store.getState().setSelection(next);
  }, [dims, store]);

  const setSel = useCallback(
    (s: Selection | null, focus = true) => {
      store.getState().setSelection(s);
      focusRequested.current = focus;
    },
    [store],
  );

  // Keep the active cell in view and give it DOM focus (roving tabindex).
  useLayoutEffect(() => {
    if (!selection) return;
    const el = viewportRef.current;
    if (!el) return;
    const next = scrollTopToReveal({
      row: selection.active.row,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight || viewportHeight,
      rowHeight: ROW_HEIGHT,
      headerHeight: HEADER_HEIGHT,
    });
    if (next !== el.scrollTop) {
      el.scrollTop = next;
      setScrollTop(next);
    }
    if (focusRequested.current && !store.getState().editing) {
      focusRequested.current = false;
      document
        .getElementById(cellDomId(gridId, selection.active.row, selection.active.col))
        ?.focus({ preventScroll: true });
    }
  }, [selection, gridId, store, viewportHeight]);

  // ---- editing ---------------------------------------------------------------
  const rowAt = useCallback((i: number) => {
    const l = latest.current;
    return l.rowsById.get(l.order[i] ?? '');
  }, []);

  const beginEdit = useCallback(
    (pos: CellPos, replaceWith?: string) => {
      const { me: who, locale: loc } = latest.current;
      const row = rowAt(pos.row);
      const col = COLUMNS[pos.col];
      if (!row || !col) return;
      const key = cellKey(row.id, col.field);
      // Enter/F2 on a cell in conflict means "resolve it": hand over to the conflict popover.
      if (store.getState().conflicts[key]) {
        onCommandRef.current?.({ type: 'conflict' }, store.getState().selection!);
        return;
      }
      if (!canEditRow(who, row)) {
        store.getState().setErrors({ [key]: { code: 'readOnly', field: col.field } });
        return;
      }
      store.getState().setErrors({ [key]: null });
      let draft = editText(col.field, row[col.field], loc);
      if (replaceWith !== undefined) {
        draft = replaceWith;
        if (col.kind === 'select') {
          const group = col.field === 'category' ? 'categories' : 'status';
          const hit = col.options?.find((o) =>
            t(`${group}.${o}`).toLowerCase().startsWith(replaceWith.toLowerCase()),
          );
          draft = hit ?? String(row[col.field] ?? '');
        }
      }
      store.getState().startEditing({
        pos,
        draft,
        origin: replaceWith !== undefined ? 'replace' : 'open',
        seed: replaceWith,
      });
    },
    [rowAt, store, t],
  );

  const stopEditing = useCallback(() => {
    store.getState().stopEditing();
    focusRequested.current = true;
    // re-trigger the focus effect even when the selection object is unchanged
    const s = store.getState().selection;
    if (s) store.getState().setSelection({ ...s });
  }, [store]);

  /** Returns false when the draft was rejected (the editor stays open). */
  const commitEdit = useCallback(
    (move: Dir | 'none'): boolean => {
      const { editing, selection: sel } = store.getState();
      if (!editing) return true;
      const l = latest.current;
      const row = rowAt(editing.pos.row);
      const col = COLUMNS[editing.pos.col];
      if (!row || !col) {
        stopEditing();
        return true;
      }
      const plan = planCellEdit({
        row,
        field: col.field,
        draft: editing.draft,
        locale: l.locale,
        me: l.me,
      });
      if (!plan.ok) {
        // Invalid: highlight and explain; nothing is sent. Enter/Tab keep the editor open, leaving (blur/click) does not.
        const patch: Record<string, CellError> = {};
        for (const e of plan.errors) patch[cellKey(row.id, e.field)] = e;
        // A rule broken on ANOTHER cell (e.g. "active needs a price") must also be explained where the person is looking.
        const here = cellKey(row.id, col.field);
        if (!(here in patch) && plan.errors[0]) patch[here] = plan.errors[0];
        store.getState().setErrors(patch);
        if (move === 'none') {
          stopEditing();
          return true;
        }
        return false;
      }
      store.getState().setErrors({ [cellKey(row.id, col.field)]: null });
      if (plan.edits.length) l.commit(plan.edits, 'edit');
      store.getState().stopEditing();
      focusRequested.current = true;
      if (sel) setSel(move === 'none' ? { ...sel } : advance(sel, l.dims, move));
      return true;
    },
    [rowAt, setSel, stopEditing, store],
  );

  const cancelEdit = useCallback(() => {
    const { editing } = store.getState();
    if (editing) {
      const row = rowAt(editing.pos.row);
      const col = COLUMNS[editing.pos.col];
      if (row && col) store.getState().setErrors({ [cellKey(row.id, col.field)]: null });
    }
    stopEditing();
  }, [rowAt, stopEditing, store]);

  // ---- bulk actions: copy / cut / paste / clear / fill ------------------------
  const getCtx = useCallback(
    () => ({
      rowAt,
      dims: latest.current.dims,
      me: latest.current.me,
      locale: latest.current.locale,
      commit: latest.current.commit,
    }),
    [rowAt],
  );
  const clipProxy = useRef<HTMLTextAreaElement>(null);
  const focusActiveCell = useCallback(() => {
    const a = store.getState().selection?.active;
    // Synchronous: keystrokes that follow immediately must reach the grid, not the hidden proxy field.
    if (a) document.getElementById(cellDomId(gridId, a.row, a.col))?.focus({ preventScroll: true });
  }, [gridId, store]);
  const actions = useGridActions(getCtx, onNotice, focusActiveCell);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fillPreview, setFillPreview] = useState<CellRange | null>(null);

  const colLeft = useMemo(() => {
    const out: number[] = [];
    let x = 0;
    for (const c of COLUMNS) {
      out.push(x);
      x += widths[c.field] ?? c.width;
    }
    return out;
  }, [widths]);
  const colWidthList = useMemo(() => COLUMNS.map((c) => widths[c.field] ?? c.width), [widths]);

  const startFill = (e: PointerEvent<HTMLDivElement>) => {
    const sel = store.getState().selection;
    const vp = viewportRef.current;
    const grid = contentRef.current;
    if (!sel || !vp || !grid) return;
    e.preventDefault();
    e.stopPropagation();
    const source = selectionRange(sel);
    let pointer = { x: e.clientX, y: e.clientY };
    let ext = source;
    let raf = 0;
    const colAt = (x: number) => {
      for (let i = colLeft.length - 1; i >= 0; i--) if (x >= colLeft[i]!) return i;
      return 0;
    };
    const compute = () => {
      const rect = grid.getBoundingClientRect();
      const row = Math.min(
        Math.max(Math.floor((pointer.y - rect.top - HEADER_HEIGHT) / ROW_HEIGHT), 0),
        Math.max(0, latest.current.dims.rows - 1),
      );
      const col = colAt(pointer.x - rect.left);
      const dRow = row > source.r2 ? row - source.r2 : row < source.r1 ? source.r1 - row : 0;
      const dCol = col > source.c2 ? col - source.c2 : col < source.c1 ? source.c1 - col : 0;
      ext =
        dRow === 0 && dCol === 0
          ? source
          : dRow >= dCol
            ? { ...source, r1: Math.min(source.r1, row), r2: Math.max(source.r2, row) }
            : { ...source, c1: Math.min(source.c1, col), c2: Math.max(source.c2, col) };
      setFillPreview(ext === source ? null : ext);
    };
    // Dragging 500 rows needs the viewport to follow the pointer.
    const tick = () => {
      const r = vp.getBoundingClientRect();
      const edge = 36;
      let dy = 0;
      if (pointer.y > r.bottom - edge) dy = Math.min(40, (pointer.y - (r.bottom - edge)) / 2 + 4);
      else if (pointer.y < r.top + HEADER_HEIGHT + edge)
        dy = -Math.min(40, (r.top + HEADER_HEIGHT + edge - pointer.y) / 2 + 4);
      if (dy !== 0) {
        vp.scrollTop += dy;
        compute();
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: globalThis.PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      compute();
    };
    const end = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (raf) cancelAnimationFrame(raf);
      setFillPreview(null);
      if (ev.type === 'pointerup') {
        pointer = { x: ev.clientX, y: ev.clientY };
        compute();
        if (ext !== source) actions.applyFill(source, ext, ev.ctrlKey || ev.metaKey);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  };

  // ---- keyboard --------------------------------------------------------------
  const pageRows = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (store.getState().editing) return; // the editor owns the keyboard
    // Header buttons, resize handles and filter popovers have their own keys; only cells drive the grid.
    if (!(e.target as HTMLElement).closest('[role="gridcell"]')) return;
    const sel = store.getState().selection;
    // Ctrl/Cmd + C / X / V: not every browser fires copy/paste for a focused non-editable cell (Firefox does
    // not). A hidden text field takes focus for the keystroke, so the NATIVE event fires everywhere; the
    // handlers then hand focus back to the cell.
    const k = e.key.toLowerCase();
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (k === 'c' || k === 'x' || k === 'v')
    ) {
      const proxy = clipProxy.current;
      if (proxy && store.getState().selection) {
        proxy.value = k === 'v' ? '' : (actions.copyText() ?? '');
        proxy.focus();
        proxy.select();
        window.setTimeout(() => {
          if (document.activeElement === proxy) focusActiveCell(); // the browser did nothing (e.g. paste blocked)
        }, 500);
      }
      return;
    }
    const action = resolveKey(e);
    if (!action) return;
    if (!sel) {
      // First key press on a grid with no selection: start at the first cell.
      if (dims.rows > 0 && action.type !== 'escape') {
        e.preventDefault();
        setSel(single({ row: 0, col: 0 }));
      }
      return;
    }
    e.preventDefault();
    switch (action.type) {
      case 'arrow':
        return setSel(arrow(sel, dims, action.dir, action.extend));
      case 'edge':
        return setSel(arrowToEdge(sel, dims, action.dir, action.extend));
      case 'home':
        return setSel(home(sel, dims, action.ctrl, action.extend));
      case 'end':
        return setSel(end(sel, dims, action.ctrl, action.extend));
      case 'page':
        return setSel(page(sel, dims, pageRows, action.dir, action.extend));
      case 'selectAll':
        return setSel(selectAll(sel, dims));
      case 'advance':
        return setSel(advance(sel, dims, action.dir));
      case 'edit':
        return beginEdit(sel.active, action.replaceWith);
      case 'escape': {
        const r = selectionRange(sel);
        if (rangeSize(r) > 1) setSel(single(sel.active));
        return;
      }
      case 'clear':
        return actions.clearRange(selectionRange(sel));
      case 'fillDown': {
        const r = selectionRange(sel);
        if (r.r2 > r.r1) actions.applyFill({ ...r, r2: r.r1 }, r, false);
        return;
      }
      default:
        onCommand?.(action, sel);
    }
  };

  // Tab (or a click on the grid's frame) lands DOM focus on the tabbable cell; make that the selection, so the
  // next arrow key moves from it instead of merely selecting it.
  const onGridFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (store.getState().selection || store.getState().editing) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!el) return;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    if (Number.isInteger(row) && Number.isInteger(col)) setSel(single({ row, col }), false);
  };

  // ---- mouse -----------------------------------------------------------------
  const posFromEvent = (e: MouseEvent): CellPos | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!el) return null;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input,select,[data-fill-handle]')) return;
    const pos = posFromEvent(e);
    if (!pos) return;
    const cur = store.getState().selection;
    if (store.getState().editing) commitEdit('none'); // clicking away commits, like Excel
    if (e.shiftKey && cur) setSel({ ...cur, focus: pos });
    else setSel(single(pos));
    store.getState().setDragSelecting(true);
    const up = () => {
      store.getState().setDragSelecting(false);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mouseup', up);
  };

  const onMouseOver = (e: MouseEvent<HTMLDivElement>) => {
    if (!store.getState().isDragSelecting) return;
    const pos = posFromEvent(e);
    const cur = store.getState().selection;
    if (pos && cur && (cur.focus.row !== pos.row || cur.focus.col !== pos.col)) {
      store.getState().setSelection({ ...cur, focus: pos });
    }
  };

  // ---- render ----------------------------------------------------------------
  const cssVars = useMemo(() => {
    const v: Record<string, string> = {};
    let total = 0;
    COLUMNS.forEach((c, i) => {
      const w = widths[c.field] ?? c.width;
      v[`--w-${i}`] = `${w}px`;
      total += w;
    });
    v['--w-total'] = `${total}px`;
    return v as CSSProperties;
  }, [widths]);

  const status = selection
    ? rangeSize(selectionRange(selection)) > 1
      ? t('grid.selectedCells', { count: rangeSize(selectionRange(selection)) })
      : ''
    : '';

  return (
    <div className={className} style={{ display: 'contents' }}>
      <div
        ref={viewportRef}
        data-testid="grid-viewport"
        className="relative h-full min-h-0 overflow-auto border border-border"
        style={{
          ...cssVars,
          scrollPaddingTop: HEADER_HEIGHT,
          scrollPaddingLeft: widths.sku ?? 130,
        }}
        onScroll={onScroll}
      >
        <div
          role="grid"
          aria-label={t('grid.label')}
          aria-rowcount={order.length + 1}
          aria-colcount={COLUMNS.length}
          aria-multiselectable="true"
          tabIndex={-1}
          className="relative"
          style={{ width: 'var(--w-total)', height: HEADER_HEIGHT + order.length * ROW_HEIGHT }}
          ref={contentRef}
          onKeyDown={onKeyDown}
          onFocus={onGridFocus}
          onCopy={actions.onCopy}
          onCut={actions.onCut}
          onPaste={actions.onPaste}
          onMouseDown={onMouseDown}
          // Drag-selection is a pointer enhancement; keyboard users select with Shift+arrows.
          onMouseOver={onMouseOver}
        >
          <GridHeader sort={sort} onSort={onSort} renderFilter={renderColumnFilter} />
          <div
            role="rowgroup"
            className="absolute left-0"
            style={{ top: HEADER_HEIGHT, width: 'var(--w-total)' }}
          >
            {mounted.map((i) => {
              const row = rowsById.get(order[i] ?? '');
              if (!row) return null;
              return (
                <GridRow
                  key={row.id}
                  gridId={gridId}
                  row={row}
                  index={i}
                  editable={canEditRow(me, row)}
                  locale={locale}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                />
              );
            })}
          </div>
          {selection && !isEditing && (
            <FillHandle
              box={rangeBox(
                selectionRange(selection),
                colLeft,
                colWidthList,
                HEADER_HEIGHT,
                ROW_HEIGHT,
              )}
              onPointerDown={startFill}
            />
          )}
          {fillPreview && (
            <FillPreview
              box={rangeBox(fillPreview, colLeft, colWidthList, HEADER_HEIGHT, ROW_HEIGHT)}
            />
          )}
          {overlay}
        </div>
        <textarea
          ref={clipProxy}
          data-clip-proxy
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0"
          onCopy={actions.onCopy}
          onCut={actions.onCut}
          onPaste={actions.onPaste}
        />
        {order.length === 0 && (
          <p
            className="sticky left-0 p-6 text-sm text-muted-foreground"
            style={{ marginTop: HEADER_HEIGHT }}
          >
            {t('grid.empty')}
          </p>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
};
