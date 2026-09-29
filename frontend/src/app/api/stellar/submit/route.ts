import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

/**
 * POST /api/stellar/submit
 * Proxies signed XDR submissions to backend POST /stellar/submit.
 * Issue #83 — Client-Side Signing; Issue #88 — Secondary Market
 */
export const POST = withBackendProxy(async (request: NextRequest) => ({
  path: '/stellar/submit',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
