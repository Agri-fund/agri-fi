import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

/**
 * POST /api/investments/sell-offer
 * Proxies to backend POST /investments/sell-offer
 * Issue #88 — Secondary Market sell offer transaction builder
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');

    const response = await fetchBackend('/investments/sell-offer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader ?? '',
      },
      body: JSON.stringify(body),
    });

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
