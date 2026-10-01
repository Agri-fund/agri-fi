import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async () => ({
  path: '/users/me',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
}));
