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
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { ChangeSource, EditableField, Me, ProductRow } from '@catalog/shared';
import { COLUMNS, canEditRow, editText, type CellError, type TableQuery } from '@/entities/product';
import { planCellEdit, type CellEdit } from '@/features/edit-cell';
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
  type Dir,
  type Selection,
} from '@/shared/lib/grid';
import type { AppLocale } from '@/shared/lib/locale';
import { GridStoreProvider, useGrid, useGridStoreApi } from '../model/grid-context';
import type { GridStore } from '../model/grid-store';
import { cellKey } from '../model/grid-store';
import { resolveKey, type GridAction } from '../lib/keymap';
import { cellDomId } from './cell';
import { GridHeader, HEADER_HEIGHT } from './header';
import { GridRow, ROW_HEIGHT } from './row';

export type GridCommand = Extract<
  GridAction,
  { type: 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'clear' }
>;

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
  commit: (edits: CellEdit[], source: ChangeSource) => void;
  /** Clipboard / undo / clear are implemented by features; the grid forwards the intent. */
  onCommand?: (cmd: GridCommand, selection: Selection) => void;
  store?: GridStore;
  initialViewportHeight?: number;
  /** Slot rendered inside the scroll area after the rows (fill handle overlay etc.). */
  overlay?: ReactNode;
  className?: string;
};

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
      store
        .getState()
        .startEditing({ pos, draft, origin: replaceWith !== undefined ? 'replace' : 'open' });
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

  // ---- keyboard --------------------------------------------------------------
  const pageRows = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (store.getState().editing) return; // the editor owns the keyboard
    // Header buttons, resize handles and filter popovers have their own keys; only cells drive the grid.
    if (!(e.target as HTMLElement).closest('[role="gridcell"]')) return;
    const sel = store.getState().selection;
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
      default:
        onCommand?.(action, sel);
    }
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
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          // Drag-selection is a pointer enhancement; keyboard users select with Shift+arrows.
          // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
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
          {overlay}
        </div>
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
