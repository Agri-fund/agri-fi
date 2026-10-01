import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(
  async (_request, { params }: { params: { contractId: string } }) => ({
    path: `/soroban/campaign/${params.contractId}/state`,
  }),
);
