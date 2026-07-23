import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function POST(request: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const authHeader = request.headers.get('authorization');
    const response = await fetchBackend(`/admin/kyc/${params.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: authHeader || '', 'Content-Type': 'application/json' },
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
