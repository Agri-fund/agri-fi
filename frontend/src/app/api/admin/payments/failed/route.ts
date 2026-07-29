import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * GET /api/admin/payments/failed?page=1&limit=20
 *
 * Proxies to the backend GET /admin/payments/failed endpoint which returns a
 * paginated list of escrow transaction_logs with status='failed'.
 *
 * Requires a valid admin JWT via Authorization: Bearer <token>.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const { searchParams } = request.nextUrl;
    const page = searchParams.get('page') ?? '1';
    const limit = searchParams.get('limit') ?? '20';

    const response = await fetchBackend(
      `/admin/payments/failed?page=${page}&limit=${limit}`,
      { headers: { Authorization: authHeader || '' } },
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
