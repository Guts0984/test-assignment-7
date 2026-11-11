import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@catalog/shared';
import { forbidden, unauthenticated } from '../common/http-error';
import { IS_PUBLIC, ROLES_KEY, type AuthedRequest } from './public.decorator';
import { SESSION_COOKIE, SessionService } from './session.service';

/** Global guard: every route needs a valid session unless marked @Public(); @Roles() narrows further. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const raw: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== 'string') throw unauthenticated();
    const user = await this.sessions.resolve(raw);
    if (!user) throw unauthenticated();
    req.user = user;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) throw forbidden('Your role cannot do this');
    return true;
  }
}
