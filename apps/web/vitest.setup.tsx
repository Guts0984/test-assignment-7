import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetMockState } from '@/shared/api/mocks/handlers';
import { server } from '@/shared/api/mocks/node';
import { hrefToUrl, navigate, resetNavigation } from '@/shared/lib/test-navigation';

// next-intl's navigation needs the Next router; unit tests use a stand-in that really updates the URL.
export const routerMock = {
  replace: vi.fn((href: Parameters<typeof navigate>[0]) => navigate(href, 'replace')),
  push: vi.fn((href: Parameters<typeof navigate>[0]) => navigate(href, 'push')),
  back: vi.fn(() => window.history.back()),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};
vi.mock('next/navigation', async () => {
  const nav = await import('@/shared/lib/test-navigation');
  return { useSearchParams: nav.useSearchParams, usePathname: () => '/', useRouter: () => ({}) };
});
vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
  Link: ({
    href,
    children,
    locale: _l,
    ...rest
  }: {
    href: string | { pathname?: string; query?: Record<string, string> };
    children: React.ReactNode;
    locale?: string;
  }) => (
    <a href={hrefToUrl(href)} {...rest}>
      {children}
    </a>
  ),
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

// `pnpm test` runs the API suite (database, scrypt) in parallel; CI runners are slow too.
configure({ asyncUtilTimeout: 10_000 });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockState();
  Object.values(routerMock).forEach((f) => f.mockClear());
  resetNavigation();
});
afterAll(() => server.close());

// jsdom gaps used by the UI.
function ResizeObserverStub(this: unknown) {
  return { observe() {}, unobserve() {}, disconnect() {} };
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => {};
