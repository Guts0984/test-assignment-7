import type { Dir } from '@/shared/lib/grid';

export type KeyInput = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export type GridAction =
  | { type: 'arrow'; dir: Dir; extend: boolean }
  | { type: 'edge'; dir: Dir; extend: boolean }
  | { type: 'home'; ctrl: boolean; extend: boolean }
  | { type: 'end'; ctrl: boolean; extend: boolean }
  | { type: 'page'; dir: 'up' | 'down'; extend: boolean }
  | { type: 'selectAll' }
  | { type: 'advance'; dir: Dir }
  | { type: 'edit'; replaceWith?: string }
  | { type: 'clear' }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'escape' };

const ARROWS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Keyboard -> intent, for a grid that is NOT in edit mode (the editor handles its own keys).
 * Cmd is treated like Ctrl so it works on macOS. Returns null for keys the grid ignores
 * (so the browser keeps them: Ctrl+R, Ctrl+W, F5, typing in other inputs...).
 */
export const resolveKey = (e: KeyInput): GridAction | null => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;

  if (mod && !e.altKey) {
    const lower = k.toLowerCase();
    if (ARROWS[k]) return { type: 'edge', dir: ARROWS[k]!, extend: e.shiftKey };
    if (k === 'Home') return { type: 'home', ctrl: true, extend: e.shiftKey };
    if (k === 'End') return { type: 'end', ctrl: true, extend: e.shiftKey };
    if (lower === 'a' && !e.shiftKey) return { type: 'selectAll' };
    if (lower === 'c' && !e.shiftKey) return { type: 'copy' };
    if (lower === 'x' && !e.shiftKey) return { type: 'cut' };
    if (lower === 'v' && !e.shiftKey) return { type: 'paste' };
    if (lower === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (lower === 'y' && !e.shiftKey) return { type: 'redo' };
    return null; // any other Ctrl/Cmd shortcut belongs to the browser
  }
  if (e.altKey) return null;

  if (ARROWS[k]) return { type: 'arrow', dir: ARROWS[k]!, extend: e.shiftKey };
  switch (k) {
    case 'Home':
      return { type: 'home', ctrl: false, extend: e.shiftKey };
    case 'End':
      return { type: 'end', ctrl: false, extend: e.shiftKey };
    case 'PageUp':
      return { type: 'page', dir: 'up', extend: e.shiftKey };
    case 'PageDown':
      return { type: 'page', dir: 'down', extend: e.shiftKey };
    case 'Tab':
      return { type: 'advance', dir: e.shiftKey ? 'left' : 'right' };
    case 'Enter':
    case 'F2':
      return { type: 'edit' };
    case 'Delete':
    case 'Backspace':
      return { type: 'clear' };
    case 'Escape':
      return { type: 'escape' };
  }
  // A single printable character starts editing and becomes the first character (like Excel).
  if (k.length === 1 && k !== ' ') return { type: 'edit', replaceWith: k };
  if (k === ' ') return { type: 'edit', replaceWith: ' ' };
  return null;
};
