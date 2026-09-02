import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const response = await fetchBackend(
      `/users/${encodeURIComponent(params.id)}/public-profile`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const err = error as { isBackendUnreachable?: boolean };
    if (err?.isBackendUnreachable) {
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
