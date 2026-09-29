import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/auth/register',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
  status: 201,
  // A new caller has no session yet; never forward a stale/foreign token.
  forwardAuth: false,
}));
