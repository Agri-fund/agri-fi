import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(
  async (_request: NextRequest, { params }: { params: { id: string } }) => ({
    path: `/admin/documents/${params.id}/verify`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }),
);
