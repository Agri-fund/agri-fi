import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  // Forward optional ?limit= query param
  const limit = request.nextUrl.searchParams.get('limit');
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';

  return {
    path: `/users/me/activity${qs}`,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});
