import createMiddleware from 'next-intl/middleware';
import { routing } from './src/shared/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Everything except API proxy, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
