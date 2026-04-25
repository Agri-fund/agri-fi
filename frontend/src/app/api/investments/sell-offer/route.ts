import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

/**
 * POST /api/investments/sell-offer
 * Proxies to backend POST /investments/sell-offer
 * Issue #88 — Secondary Market sell offer transaction builder
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');

    const response = await fetch(`${BACKEND}/investments/sell-offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader ?? '',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
