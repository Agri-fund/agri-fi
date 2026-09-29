import { withBackendProxy } from '@/lib/api-proxy';

/**
 * GET /api/investments/buy-orders/[tokenCode]/[tokenIssuer]
 * Proxies to backend GET /investments/buy-orders/:tokenCode/:tokenIssuer
 * Issue #112 — Secondary Market buy orders
 */
export const GET = withBackendProxy(
  async (
    _request,
    { params }: { params: { tokenCode: string; tokenIssuer: string } },
  ) => ({
    path: `/investments/buy-orders/${encodeURIComponent(params.tokenCode)}/${encodeURIComponent(params.tokenIssuer)}`,
  }),
);
