import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/investments',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
