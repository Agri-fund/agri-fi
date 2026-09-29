import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(
  async (request: NextRequest, { params }: { params: { id: string } }) => ({
    path: `/investments/${params.id}/submit-tx`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.json(),
  }),
);
