import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(
  async (_request, { params }: { params: { contractId: string; address: string } }) => ({
    path: `/soroban/campaign/${params.contractId}/investor/${params.address}/ownership`,
  }),
);
