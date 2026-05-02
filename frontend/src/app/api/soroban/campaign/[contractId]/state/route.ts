import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '@/config/backend';

export async function GET(
  req: NextRequest,
  { params }: { params: { contractId: string } },
) {
  const auth = req.headers.get('authorization') ?? '';
  const res = await fetch(
    `${BACKEND_URL}/soroban/campaign/${params.contractId}/state`,
    { headers: { Authorization: auth } },
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
