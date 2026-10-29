import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request) => {
  const url = new URL(request.url);
  const year = url.searchParams.get('year') ?? '';
  const path = `/tax/deadlines?year=${year}`;
  return {
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});
