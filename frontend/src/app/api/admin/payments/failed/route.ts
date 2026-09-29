import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * GET /api/admin/payments/failed?page=1&limit=20
 *
 * Proxies to the backend GET /admin/payments/failed endpoint which returns a
 * paginated list of escrow transaction_logs with status='failed'.
 *
 * Requires a valid admin JWT via Authorization: Bearer <token>.
 */
export const GET = withBackendProxy(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const page = searchParams.get('page') ?? '1';
  const limit = searchParams.get('limit') ?? '20';
  return { path: `/admin/payments/failed?page=${page}&limit=${limit}` };
});
