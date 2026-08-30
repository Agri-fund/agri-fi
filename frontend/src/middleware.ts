import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { applySecurityHeaders } from './middleware/security-headers.middleware';

const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'es', 'fr', 'pt', 'sw'],

  // Used when no locale matches
  defaultLocale: 'en',
});

export default function middleware(request: NextRequest): NextResponse {
  const response = intlMiddleware(request);
  return applySecurityHeaders(request, response);
}

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(en|es|fr|pt|sw)/:path*', '/((?!api|_next|_static|_vercel|[\\w-]+\\.\\w+).*)']
};
