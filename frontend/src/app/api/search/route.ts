import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';
    const types = searchParams.get('types') ?? '';
    const limit = searchParams.get('limit') ?? '10';

    const params = new URLSearchParams({ q, limit });
    if (types) params.set('types', types);

    const response = await fetchBackend(`/search?${params.toString()}`, {
      headers: { Authorization: authHeader || '' },
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
