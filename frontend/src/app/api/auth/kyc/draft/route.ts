import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const response = await fetchBackend('/auth/kyc/draft', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader || '',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.isBackendUnreachable) {
      return NextResponse.json(
        { message: 'Backend service is unavailable' },
        { status: 503 },
      );
    }
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');
    const response = await fetchBackend('/auth/kyc/draft', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader || '',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.isBackendUnreachable) {
      return NextResponse.json(
        { message: 'Backend service is unavailable' },
        { status: 503 },
      );
    }
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
