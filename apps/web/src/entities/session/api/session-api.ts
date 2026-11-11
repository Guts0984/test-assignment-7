import { loginRequestSchema, meSchema, type LoginRequest, type Me } from '@catalog/shared';
import { request } from '@/shared/api/http';

export const sessionKeys = { me: ['me'] as const };

export const fetchMe = (): Promise<Me> => request('/me', { schema: meSchema });

export const login = (body: LoginRequest): Promise<Me> =>
  request('/auth/login', {
    method: 'POST',
    body: loginRequestSchema.parse(body),
    schema: meSchema,
  });

export const logout = (): Promise<void> => request('/auth/logout', { method: 'POST' });
