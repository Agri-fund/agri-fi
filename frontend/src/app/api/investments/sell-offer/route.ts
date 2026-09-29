import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * POST /api/investments/sell-offer
 * Proxies to backend POST /investments/sell-offer
 * Issue #88 — Secondary Market sell offer transaction builder
 */
export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/investments/sell-offer',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
