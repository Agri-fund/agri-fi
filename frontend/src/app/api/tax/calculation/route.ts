import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request) => {
  const url = new URL(request.url);
  const year = url.searchParams.get('year') ?? '';
  const jurisdiction = url.searchParams.get('jurisdiction') ?? '';
  const path = `/tax/calculation?year=${year}&jurisdiction=${jurisdiction}`;
  return {
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});
