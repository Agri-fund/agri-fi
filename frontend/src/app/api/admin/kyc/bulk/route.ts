import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * PATCH /api/admin/kyc/bulk
 *
 * Proxies the bulk KYC approve/reject request to the backend.
 * Body: { userIds: string[], action: 'approve' | 'reject', reason?: string }
 */
export const PATCH = withBackendProxy(async (request: NextRequest) => ({
  path: '/admin/kyc/bulk',
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
