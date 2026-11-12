/** True on Apple platforms, where the command key (Meta) - not Ctrl - is the shortcut modifier. */
export const isApplePlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(p);
};

/** The key that means "command" for clipboard shortcuts on this platform (Cmd on Mac, Ctrl elsewhere). */
export const hasShortcutModifier = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  isApplePlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
