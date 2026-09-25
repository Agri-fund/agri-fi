import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE = process.env.BACKEND_URL ?? 'http://localhost:3001';

/**
 * GET /api/investments/:id/receipt
 *
 * Proxies to the backend GET /v1/investments/:id/receipt.
 * Forwards the caller's Authorization header so the backend can
 * verify ownership before generating the signed receipt URL.
 *
 * Response shape: { url: string; expiresAt: string }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const authorization = request.headers.get('authorization') ?? '';

  const backendRes = await fetch(
    `${BACKEND_BASE}/v1/investments/${id}/receipt`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      cache: 'no-store',
    },
  );

  const body = await backendRes.json().catch(() => ({}));

  if (!backendRes.ok) {
    return NextResponse.json(body, { status: backendRes.status });
  }

  return NextResponse.json(body, { status: 200 });
}
