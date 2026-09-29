import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async () => ({
  path: '/investments/my-investments',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
}));
