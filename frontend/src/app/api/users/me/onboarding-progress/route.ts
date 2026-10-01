import { NextRequest } from 'next/server';
import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async () => ({
  path: '/users/me/onboarding-progress',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
}));

export const PATCH = withBackendProxy(async (request: NextRequest) => ({
  path: '/users/me/onboarding-progress',
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: await request.json(),
}));
