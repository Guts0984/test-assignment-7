import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Me, Role } from '@catalog/shared';

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of the global AuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
/** Restrict a route to these roles (admin is NOT implicitly included; list it). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export type AuthUser = Me;
export type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  const u = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!u) throw new Error('CurrentUser used on a route without AuthGuard');
  return u;
});
