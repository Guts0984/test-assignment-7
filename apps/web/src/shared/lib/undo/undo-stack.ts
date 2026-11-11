import type { EditableField } from '@catalog/shared';

export type UndoChange = { id: string; field: EditableField; before: unknown; after: unknown };
/** One user action. A paste of 500 cells or a fill is ONE action, so one Ctrl+Z undoes all of it. */
export type UndoAction = { changes: UndoChange[]; label?: string };

export const UNDO_LIMIT = 50;

export type UndoStack = {
  readonly undoDepth: number;
  readonly redoDepth: number;
  past: readonly UndoAction[];
  future: readonly UndoAction[];
};

export const emptyStack: UndoStack = { undoDepth: 0, redoDepth: 0, past: [], future: [] };

const make = (past: readonly UndoAction[], future: readonly UndoAction[]): UndoStack => ({
  past,
  future,
  undoDepth: past.length,
  redoDepth: future.length,
});

/** Records a new action: it becomes undoable, anything that was redoable is gone, the oldest is dropped past the limit. */
export const pushAction = (s: UndoStack, a: UndoAction, limit = UNDO_LIMIT): UndoStack => {
  if (a.changes.length === 0) return s;
  const past = [...s.past, a];
  return make(past.length > limit ? past.slice(past.length - limit) : past, []);
};

/** Takes the latest action off the undo side. The caller applies its `before` values. */
export const undo = (s: UndoStack): { stack: UndoStack; action: UndoAction } | null => {
  const action = s.past[s.past.length - 1];
  if (!action) return null;
  return { action, stack: make(s.past.slice(0, -1), [...s.future, action]) };
};

export const redo = (s: UndoStack): { stack: UndoStack; action: UndoAction } | null => {
  const action = s.future[s.future.length - 1];
  if (!action) return null;
  return { action, stack: make([...s.past, action], s.future.slice(0, -1)) };
};
