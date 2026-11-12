import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasShortcutModifier, isApplePlatform } from './platform';

afterEach(() => vi.restoreAllMocks());
const as = (p: string) => vi.spyOn(navigator, 'platform', 'get').mockReturnValue(p);

describe('shortcut modifier', () => {
  it('Cmd on Apple platforms, never Ctrl', () => {
    as('MacIntel');
    expect(isApplePlatform()).toBe(true);
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(hasShortcutModifier({ ctrlKey: true, metaKey: false })).toBe(false);
  });
  it('Ctrl elsewhere, never the Windows/Super key', () => {
    as('Linux x86_64');
    expect(hasShortcutModifier({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: true })).toBe(false);
  });
});
