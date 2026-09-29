import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (_request, { params }: { params: { id: string } }) => ({
  path: `/users/${encodeURIComponent(params.id)}/public-profile`,
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
  forwardAuth: false,
}));
