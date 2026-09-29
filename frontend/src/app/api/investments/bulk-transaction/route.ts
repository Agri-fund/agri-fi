import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * POST /api/investments/bulk-transaction
 * Proxies to backend POST /investments/bulk-transaction
 * Issue #92 — Bulk Investments via Stellar Batching
 */
export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/investments/bulk-transaction',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
