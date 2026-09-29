import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
  // The caller has no session yet; never forward a stale/foreign token.
  forwardAuth: false,
}));
