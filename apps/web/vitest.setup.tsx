import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetMockState } from '@/shared/api/mocks/handlers';
import { server } from '@/shared/api/mocks/node';

// next-intl's navigation needs the Next router; unit tests use a stand-in.
export const routerMock = {
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};
vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockState();
  Object.values(routerMock).forEach((f) => f.mockClear());
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
