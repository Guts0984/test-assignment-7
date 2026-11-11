import { createStore, type StoreApi } from 'zustand/vanilla';
import type { EditableField } from '@catalog/shared';
import type { CellPos, Selection } from '@/shared/lib/grid';
import { COLUMNS } from '@/entities/product';
import type { CellError } from '@/entities/product';

export const cellKey = (id: string, field: EditableField): string => `${id}:${field}`;

export type EditingState = {
  pos: CellPos;
  /** What the person has typed so far (the editor input is controlled by this). */
  draft: string;
  /** 'replace' = started by typing (caret after the first char), 'open' = F2/Enter/double click. */
  origin: 'replace' | 'open';
};

export type ConflictInfo = {
  mine: unknown;
  theirs: unknown;
  theirsVersion: number;
  author: string | null;
};

export type GridState = {
  selection: Selection | null;
  editing: EditingState | null;
  /** Validation problems per cell, shown as a highlight + tooltip until the cell is edited again. */
  errors: Record<string, CellError>;
  /** Cells whose edit is queued or in flight. */
  saving: Record<string, true>;
  conflicts: Record<string, ConflictInfo>;
  /** Row ids that no longer match the filter but are kept in place until the next re-sort. */
  colWidths: Record<string, number>;
  isDragSelecting: boolean;
};

export type GridActions = {
  setSelection: (s: Selection | null) => void;
  startEditing: (e: EditingState) => void;
  updateDraft: (draft: string) => void;
  stopEditing: () => void;
  setErrors: (patch: Record<string, CellError | null>) => void;
  setSaving: (patch: Record<string, boolean>) => void;
  setConflicts: (patch: Record<string, ConflictInfo | null>) => void;
  setColWidth: (field: EditableField, width: number) => void;
  setDragSelecting: (v: boolean) => void;
};

export type GridStore = StoreApi<GridState & GridActions>;

const applyPatch = <T>(
  cur: Record<string, T>,
  patch: Record<string, T | null | boolean>,
): Record<string, T> => {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === false) delete next[k];
    else next[k] = (v === true ? true : v) as T;
  }
  return next;
};

/** One store per grid instance (tests and Storybook get isolated state). */
export const createGridStore = (initial: Partial<GridState> = {}): GridStore =>
  createStore<GridState & GridActions>((set) => ({
    selection: null,
    editing: null,
    errors: {},
    saving: {},
    conflicts: {},
    colWidths: Object.fromEntries(COLUMNS.map((c) => [c.field, c.width])),
    isDragSelecting: false,
    ...initial,
    setSelection: (selection) => set({ selection }),
    startEditing: (editing) => set({ editing }),
    updateDraft: (draft) => set((s) => (s.editing ? { editing: { ...s.editing, draft } } : s)),
    stopEditing: () => set({ editing: null }),
    setErrors: (patch) => set((s) => ({ errors: applyPatch(s.errors, patch) })),
    setSaving: (patch) => set((s) => ({ saving: applyPatch(s.saving, patch) })),
    setConflicts: (patch) => set((s) => ({ conflicts: applyPatch(s.conflicts, patch) })),
    setColWidth: (field, width) => set((s) => ({ colWidths: { ...s.colWidths, [field]: width } })),
    setDragSelecting: (isDragSelecting) => set({ isDragSelecting }),
  }));
