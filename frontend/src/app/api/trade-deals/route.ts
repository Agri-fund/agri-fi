import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '12';
    const commodity = searchParams.get('commodity') || '';

    const query = new URLSearchParams({ page, limit });
    if (commodity) query.set('commodity', commodity);

    const response = await fetchBackend(`/trade-deals?${query}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.isBackendUnreachable)
      return NextResponse.json({ message: 'Backend service is unavailable' }, { status: 503 });
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization');

    const response = await fetchBackend('/trade-deals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader || '',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    if (error?.isBackendUnreachable)
      return NextResponse.json({ message: 'Backend service is unavailable' }, { status: 503 });
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}