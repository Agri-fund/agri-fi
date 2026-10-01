import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(async () => ({
  path: '/auth/logout',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
}));
