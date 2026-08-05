import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * POST /api/admin/payments/failed/[txId]/retry
 *
 * Proxies to the backend POST /admin/payments/failed/:id/retry endpoint which
 * re-enqueues the `deal.delivered` event for the associated trade deal,
 * triggering another escrow release attempt.
 *
 * Requires a valid admin JWT via Authorization: Bearer <token>.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { txId: string } },
) {
  try {
    const authHeader = request.headers.get('authorization');

    const response = await fetchBackend(
      `/admin/payments/failed/${params.txId}/retry`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader || '',
          'Content-Type': 'application/json',
        },
      },
    );

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.isBackendUnreachable) {
      return NextResponse.json(
        { message: 'Backend service is unavailable' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
