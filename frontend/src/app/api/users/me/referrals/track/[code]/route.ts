import { withBackendProxy } from '@/lib/api-proxy';

export const POST = withBackendProxy(
  async (_request, { params }: { params: { code: string } }) => ({
    path: `/users/me/referrals/track/${params.code}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    forwardAuth: false,
  }),
);
