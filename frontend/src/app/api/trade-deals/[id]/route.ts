import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (_request, { params }: { params: { id: string } }) => ({
  path: `/trade-deals/${params.id}`,
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
  forwardAuth: false,
}));
