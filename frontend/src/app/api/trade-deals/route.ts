import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (value) query.set(key, value);
  }
  if (!query.has('page')) query.set('page', '1');
  if (!query.has('limit')) query.set('limit', '12');

  return {
    path: `/trade-deals?${query}`,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    forwardAuth: false,
  };
});

export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/trade-deals',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
  status: 201,
}));
