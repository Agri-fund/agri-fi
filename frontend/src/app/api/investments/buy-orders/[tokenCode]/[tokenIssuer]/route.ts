import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * GET /api/investments/buy-orders/[tokenCode]/[tokenIssuer]
 * Proxies to backend GET /investments/buy-orders/:tokenCode/:tokenIssuer
 * Issue #112 — Secondary Market buy orders
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tokenCode: string; tokenIssuer: string } },
) {
  try {
    const authHeader = request.headers.get('authorization');
    const { tokenCode, tokenIssuer } = params;

    const response = await fetchBackend(
      `/investments/buy-orders/${encodeURIComponent(tokenCode)}/${encodeURIComponent(tokenIssuer)}`,
      {
        headers: {
          Authorization: authHeader ?? '',
        },
      },
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.isBackendUnreachable) {
      return NextResponse.json(
        { message: 'Backend service is unavailable' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

