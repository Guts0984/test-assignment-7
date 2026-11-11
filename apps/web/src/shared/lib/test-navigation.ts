import { useSyncExternalStore } from 'react';

/** A tiny stand-in for the Next/next-intl router that really updates `window.location` and history. */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type Href = string | { pathname?: string; query?: Record<string, string | string[] | undefined> };

export const hrefToUrl = (href: Href): string => {
  if (typeof href === 'string') return href;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(href.query ?? {}))
    if (v !== undefined) q.set(k, Array.isArray(v) ? v.join(',') : v);
  const qs = q.toString();
  return `${href.pathname ?? '/'}${qs ? `?${qs}` : ''}`;
};

export const navigate = (href: Href, mode: 'push' | 'replace'): void => {
  const url = hrefToUrl(href);
  if (mode === 'push') window.history.pushState({}, '', url);
  else window.history.replaceState({}, '', url);
  notify();
};

export const resetNavigation = (): void => {
  window.history.replaceState({}, '', '/');
  notify();
};

export const useSearchParams = (): URLSearchParams => {
  const s = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => '',
  );
  return new URLSearchParams(s);
};
