import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request) => {
  const url = new URL(request.url);
  const year = url.searchParams.get('year') ?? '';
  const format = url.searchParams.get('format') ?? 'csv';
  const path = `/tax/accountant-export?year=${year}&format=${format}`;
  return {
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});
