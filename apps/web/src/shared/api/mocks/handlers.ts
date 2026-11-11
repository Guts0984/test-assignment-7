import { http, HttpResponse } from 'msw';
import type { Me } from '@catalog/shared';
import { createMockBackend } from './mock-backend';

/**
 * The single set of API stand-ins: used by unit tests (msw/node) and by Storybook (msw/browser).
 * Handlers keep tiny in-memory state; `resetMockState` puts it back between tests.
 */
export const USERS: Record<string, { password: string; me: Me }> = {
  admin: {
    password: 'admin-pass-123',
    me: {
      id: '11111111-1111-4111-8111-111111111111',
      login: 'admin',
      role: 'admin',
      categories: [],
    },
  },
  editor1: {
    password: 'editor1-pass-123',
    me: {
      id: '22222222-2222-4222-8222-222222222222',
      login: 'editor1',
      role: 'editor',
      categories: ['electronics', 'computers', 'phones', 'home-appliances', 'furniture'],
    },
  },
  viewer: {
    password: 'viewer-pass-123',
    me: {
      id: '44444444-4444-4444-8444-444444444444',
      login: 'viewer',
      role: 'viewer',
      categories: [],
    },
  },
};

type State = { current: Me | null };
const state: State = { current: null };
export const backend = createMockBackend(2000);

export const resetMockState = (): void => {
  state.current = null;
  backend.reset();
};
export const signInAs = (login: keyof typeof USERS): void => {
  state.current = USERS[login]!.me;
  backend.signIn(state.current);
};

const error = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  HttpResponse.json({ error: { code, message } }, { status, headers });

export const sessionHandlers = [
  http.get('*/api/me', () =>
    state.current
      ? HttpResponse.json(state.current)
      : error(401, 'unauthenticated', 'Authentication required'),
  ),
  http.post('*/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { login?: string; password?: string };
    const u = body.login ? USERS[body.login] : undefined;
    if (!u || u.password !== body.password)
      return error(401, 'unauthenticated', 'Invalid login or password');
    state.current = u.me;
    backend.signIn(u.me);
    return HttpResponse.json(u.me);
  }),
  http.post('*/api/auth/logout', () => {
    state.current = null;
    backend.signIn(null);
    return new HttpResponse(null, { status: 204 });
  }),
];

export const handlers = [...sessionHandlers, ...backend.handlers];
