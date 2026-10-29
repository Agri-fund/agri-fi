import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (request) => {
  const url = new URL(request.url);
  const year = url.searchParams.get('year') ?? '';
  const format = url.searchParams.get('format') ?? 'csv';
  const path = `/tax/forms?year=${year}&format=${format}`;
  return {
    path,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
});

export const POST = withBackendProxy(async (request) => ({
  path: '/tax/forms',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
