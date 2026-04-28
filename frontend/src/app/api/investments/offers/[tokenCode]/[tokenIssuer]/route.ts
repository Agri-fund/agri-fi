import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * GET /api/investments/offers/[tokenCode]/[tokenIssuer]
 * Proxies to backend GET /investments/offers/:tokenCode/:tokenIssuer
 * Issue #88 — Secondary Market order book
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tokenCode: string; tokenIssuer: string } },
) {
  try {
    const authHeader = request.headers.get('authorization');
    const { tokenCode, tokenIssuer } = params;

    const response = await fetchBackend(
      `/investments/offers/${encodeURIComponent(tokenCode)}/${encodeURIComponent(tokenIssuer)}`,
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
