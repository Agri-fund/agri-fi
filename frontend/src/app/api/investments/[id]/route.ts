import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async (_request, { params }: { params: { id: string } }) => ({
  path: `/investments/${params.id}`,
}));
