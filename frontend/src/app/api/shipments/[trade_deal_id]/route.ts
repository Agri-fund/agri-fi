import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(
  async (_request, { params }: { params: { trade_deal_id: string } }) => ({
    path: `/shipments/${params.trade_deal_id}`,
    method: 'GET',
  }),
);
