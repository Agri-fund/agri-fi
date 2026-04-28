import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '12';

    const response = await fetchBackend(`/trade-deals?page=${page}&limit=${limit}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
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