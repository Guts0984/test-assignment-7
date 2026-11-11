import { describe, expect, it } from 'vitest';
import { resolveKey, type KeyInput } from './keymap';

const key = (k: string, m: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...m,
});

describe('resolveKey', () => {
  it('arrows move, Shift extends, Ctrl/Cmd jumps to the edge', () => {
    expect(resolveKey(key('ArrowDown'))).toEqual({ type: 'arrow', dir: 'down', extend: false });
    expect(resolveKey(key('ArrowRight', { shiftKey: true }))).toEqual({
      type: 'arrow',
      dir: 'right',
      extend: true,
    });
    expect(resolveKey(key('ArrowUp', { ctrlKey: true }))).toEqual({
      type: 'edge',
      dir: 'up',
      extend: false,
    });
    expect(resolveKey(key('ArrowUp', { metaKey: true, shiftKey: true }))).toEqual({
      type: 'edge',
      dir: 'up',
      extend: true,
    });
  });
  it('Home/End/PageUp/PageDown, with Ctrl for the corners', () => {
    expect(resolveKey(key('Home'))).toEqual({ type: 'home', ctrl: false, extend: false });
    expect(resolveKey(key('End', { ctrlKey: true }))).toEqual({
      type: 'end',
      ctrl: true,
      extend: false,
    });
    expect(resolveKey(key('PageDown', { shiftKey: true }))).toEqual({
      type: 'page',
      dir: 'down',
      extend: true,
    });
    expect(resolveKey(key('PageUp'))).toEqual({ type: 'page', dir: 'up', extend: false });
  });
  it('Tab / Shift+Tab advance right / left', () => {
    expect(resolveKey(key('Tab'))).toEqual({ type: 'advance', dir: 'right' });
    expect(resolveKey(key('Tab', { shiftKey: true }))).toEqual({ type: 'advance', dir: 'left' });
  });
  it('Enter and F2 start editing; typing starts editing with that character', () => {
    expect(resolveKey(key('Enter'))).toEqual({ type: 'edit' });
    expect(resolveKey(key('F2'))).toEqual({ type: 'edit' });
    expect(resolveKey(key('a'))).toEqual({ type: 'edit', replaceWith: 'a' });
    expect(resolveKey(key('A', { shiftKey: true }))).toEqual({ type: 'edit', replaceWith: 'A' });
    expect(resolveKey(key('5'))).toEqual({ type: 'edit', replaceWith: '5' });
    expect(resolveKey(key(','))).toEqual({ type: 'edit', replaceWith: ',' });
    expect(resolveKey(key('ї'))).toEqual({ type: 'edit', replaceWith: 'ї' });
    expect(resolveKey(key(' '))).toEqual({ type: 'edit', replaceWith: ' ' });
  });
  it('clipboard keys are left to the browser (native copy/cut/paste events); select-all, fill-down and undo/redo with Ctrl and Cmd', () => {
    for (const m of [{ ctrlKey: true }, { metaKey: true }]) {
      for (const k of ['c', 'x', 'v']) expect(resolveKey(key(k, m))).toBeNull();
      expect(resolveKey(key('d', m))).toEqual({ type: 'fillDown' });
      expect(resolveKey(key('a', m))).toEqual({ type: 'selectAll' });
      expect(resolveKey(key('z', m))).toEqual({ type: 'undo' });
      expect(resolveKey(key('z', { ...m, shiftKey: true }))).toEqual({ type: 'redo' });
      expect(resolveKey(key('Z', { ...m, shiftKey: true }))).toEqual({ type: 'redo' });
      expect(resolveKey(key('y', m))).toEqual({ type: 'redo' });
    }
  });
  it('works with a non-Latin keyboard layout letter? (physical key not used; key value is)', () => {
    // On a Ukrainian layout Ctrl+C reports key "с" (Cyrillic); the browser still fires copy. We do not hijack it.
    expect(resolveKey(key('с', { ctrlKey: true }))).toBeNull();
  });
  it('does NOT hijack browser shortcuts or printable keys with Ctrl/Alt', () => {
    for (const k of ['r', 'w', 't', 'l', 'p', 's', 'f', 'n'])
      expect(resolveKey(key(k, { ctrlKey: true }))).toBeNull();
    expect(resolveKey(key('F5'))).toBeNull();
    expect(resolveKey(key('a', { altKey: true }))).toBeNull();
    expect(resolveKey(key('Shift'))).toBeNull();
    expect(resolveKey(key('Control'))).toBeNull();
    expect(resolveKey(key('Dead'))).toBeNull();
  });
  it('Delete/Backspace clear, Escape escapes', () => {
    expect(resolveKey(key('Delete'))).toEqual({ type: 'clear' });
    expect(resolveKey(key('Backspace'))).toEqual({ type: 'clear' });
    expect(resolveKey(key('Escape'))).toEqual({ type: 'escape' });
  });
});
