import { describe, expect, it } from 'vitest';
import { UNDO_LIMIT, emptyStack, pushAction, redo, undo, type UndoAction } from './undo-stack';

const act = (n: number, cells = 1): UndoAction => ({
  changes: Array.from({ length: cells }, (_, i) => ({
    id: `id-${n}-${i}`,
    field: 'stock',
    before: n - 1,
    after: n,
  })),
});

describe('undo stack', () => {
  it('undo returns the latest action; redo brings it back', () => {
    let s = pushAction(emptyStack, act(1));
    s = pushAction(s, act(2));
    const u = undo(s)!;
    expect(u.action.changes[0]!.after).toBe(2);
    expect(u.stack.undoDepth).toBe(1);
    expect(u.stack.redoDepth).toBe(1);
    const r = redo(u.stack)!;
    expect(r.action.changes[0]!.after).toBe(2);
    expect(r.stack.undoDepth).toBe(2);
    expect(r.stack.redoDepth).toBe(0);
  });
  it('a multi-cell paste/fill is ONE step', () => {
    const s = pushAction(emptyStack, act(1, 500));
    expect(s.undoDepth).toBe(1);
    expect(undo(s)!.action.changes).toHaveLength(500);
  });
  it('a new action clears the redo history', () => {
    let s = pushAction(pushAction(emptyStack, act(1)), act(2));
    s = undo(s)!.stack;
    expect(s.redoDepth).toBe(1);
    s = pushAction(s, act(3));
    expect(s.redoDepth).toBe(0);
    expect(redo(s)).toBeNull();
  });
  it('keeps only the last 50 actions', () => {
    let s = emptyStack;
    for (let i = 1; i <= 80; i++) s = pushAction(s, act(i));
    expect(s.undoDepth).toBe(UNDO_LIMIT);
    expect(s.past[0]!.changes[0]!.after).toBe(31); // 1..30 dropped
    let n = 0;
    for (let r = undo(s); r; r = undo(r.stack)) n++;
    expect(n).toBe(50);
  });
  it('undo on an empty stack is a no-op, not an error', () => {
    expect(undo(emptyStack)).toBeNull();
    expect(redo(emptyStack)).toBeNull();
  });
  it('empty actions are not recorded (nothing to undo)', () => {
    expect(pushAction(emptyStack, { changes: [] })).toBe(emptyStack);
  });
  it('undo/redo are repeatable all the way down and back up', () => {
    let s = emptyStack;
    for (let i = 1; i <= 5; i++) s = pushAction(s, act(i));
    for (let i = 0; i < 5; i++) s = undo(s)!.stack;
    expect([s.undoDepth, s.redoDepth]).toEqual([0, 5]);
    for (let i = 0; i < 5; i++) s = redo(s)!.stack;
    expect([s.undoDepth, s.redoDepth]).toEqual([5, 0]);
  });
});
