import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * POST /api/admin/payments/failed/[txId]/retry
 *
 * Proxies to the backend POST /admin/payments/failed/:id/retry endpoint which
 * re-enqueues the `deal.delivered` event for the associated trade deal,
 * triggering another escrow release attempt.
 *
 * Requires a valid admin JWT via Authorization: Bearer <token>.
 */
export const POST = withBackendProxy(
  async (_request: NextRequest, { params }: { params: { txId: string } }) => ({
    path: `/admin/payments/failed/${params.txId}/retry`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }),
);
