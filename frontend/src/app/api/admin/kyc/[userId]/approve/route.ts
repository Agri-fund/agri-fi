import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(
  async (_request: NextRequest, { params }: { params: { userId: string } }) => ({
    path: `/admin/kyc/${params.userId}/approve`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }),
);
