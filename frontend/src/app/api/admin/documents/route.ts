import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  const status = request.nextUrl.searchParams.get('status');
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return { path: `/admin/documents${query}` };
});
