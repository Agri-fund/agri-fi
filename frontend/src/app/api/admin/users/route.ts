import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async () => ({
  path: '/admin/users',
}));
