import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const authHeader = request.headers.get('authorization');
    const body = await request.json();
    const response = await fetchBackend(`/admin/users/${params.userId}/role`, {
      method: 'POST',
      headers: { Authorization: authHeader || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
