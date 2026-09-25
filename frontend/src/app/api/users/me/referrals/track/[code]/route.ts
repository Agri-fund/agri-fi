import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    const response = await fetchBackend(`/users/me/referrals/track/${params.code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
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
