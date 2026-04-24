import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

/**
 * POST /api/stellar/submit
 * Proxies signed XDR submissions to backend POST /stellar/submit.
 * Issue #83 — Client-Side Signing; Issue #88 — Secondary Market
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');

    const response = await fetch(`${BACKEND}/stellar/submit`, {
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
