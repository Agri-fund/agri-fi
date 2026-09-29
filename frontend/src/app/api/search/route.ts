import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const types = searchParams.get('types') ?? '';
  const limit = searchParams.get('limit') ?? '10';

  const params = new URLSearchParams({ q, limit });
  if (types) params.set('types', types);

  return { path: `/search?${params.toString()}` };
});
