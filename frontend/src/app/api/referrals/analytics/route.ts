import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel');
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';

  return {
    path: `/referrals/analytics${query}`,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    forwardAuth: false,
  };
});
