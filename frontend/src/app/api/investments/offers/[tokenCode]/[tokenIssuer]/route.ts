import { withBackendProxy } from '@/lib/api-proxy';

/**
 * GET /api/investments/offers/[tokenCode]/[tokenIssuer]
 * Proxies to backend GET /investments/offers/:tokenCode/:tokenIssuer
 * Issue #88 — Secondary Market order book
 */
export const GET = withBackendProxy(
  async (
    _request,
    { params }: { params: { tokenCode: string; tokenIssuer: string } },
  ) => ({
    path: `/investments/offers/${encodeURIComponent(params.tokenCode)}/${encodeURIComponent(params.tokenIssuer)}`,
  }),
);
