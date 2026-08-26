import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'es', 'fr', 'pt', 'sw'],

  // Used when no locale matches
  defaultLocale: 'en'
});

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(en|es|fr|pt|sw)/:path*', '/((?!api|_next|_static|_vercel|[\\w-]+\\.\\w+).*)']
};
