import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(
  async (request: NextRequest, { params }: { params: { id: string } }) => ({
    path: `/admin/documents/${params.id}/reject`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.json(),
  }),
);
