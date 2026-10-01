import { withBackendProxy } from '@/lib/api-proxy';

// GET /trade-deals/:id/health is a public backend endpoint (no guard) —
// forwardAuth: false preserves that this route never sent an
// Authorization header, matching its pre-#973 behavior exactly.
export const GET = withBackendProxy<{ params: { id: string } }>(
  async (_request, { params }) => ({
    path: `/trade-deals/${params.id}/health`,
    forwardAuth: false,
  }),
);
