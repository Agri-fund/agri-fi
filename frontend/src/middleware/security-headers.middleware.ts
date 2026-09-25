import { NextResponse, type NextRequest } from 'next/server';

export function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  // Generate cryptographically secure random nonce per request
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Propagate nonce to request headers for Next.js internal script injection
  request.headers.set('x-nonce', nonce);
  response.headers.set('x-nonce', nonce);

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://ipfs.io https://*.cloudfront.net",
    "connect-src 'self' wss://api.agri-fi.com https://horizon.stellar.org https://horizon-testnet.stellar.org",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
  ].join('; ');

  const mode = process.env.CSP_MODE || 'report-only';
  if (mode === 'enforce') {
    response.headers.set('Content-Security-Policy', cspDirectives);
  } else {
    response.headers.set('Content-Security-Policy-Report-Only', cspDirectives);
  }

  return response;
}
