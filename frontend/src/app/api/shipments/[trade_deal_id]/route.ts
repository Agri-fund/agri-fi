import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

export async function GET(
  request: NextRequest,
  { params }: { params: { trade_deal_id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');

    const response = await fetchBackend(
      `/shipments/${params.trade_deal_id}`,
      {
        method: 'GET',
        headers: {
          'Authorization': authHeader || '',
        },
      }
    );

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