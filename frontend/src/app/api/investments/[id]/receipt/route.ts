import { withBackendProxy } from '@/lib/api-proxy';

/**
 * GET /api/investments/:id/receipt
 *
 * Proxies to the backend GET /v1/investments/:id/receipt.
 * Forwards the caller's Authorization header so the backend can
 * verify ownership before generating the signed receipt URL.
 *
 * Response shape: { url: string; expiresAt: string }
 */
export const GET = withBackendProxy(async (_request, { params }: { params: { id: string } }) => ({
  path: `/investments/${params.id}/receipt`,
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
}));
