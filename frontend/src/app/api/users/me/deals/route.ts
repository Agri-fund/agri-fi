import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role');
  const path = role ? `/users/me/deals?role=${role}` : '/users/me/deals';

  return {
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});
