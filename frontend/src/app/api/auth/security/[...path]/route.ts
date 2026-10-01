import { NextRequest, NextResponse } from 'next/server';
import { fetchBackend } from '@/config/backend';

const endpoints: Record<string, { method: 'GET' | 'POST'; path: string }> = {
  'change-password': { method: 'POST', path: '/auth/change-password' },
  'mfa/setup': { method: 'GET', path: '/auth/mfa/setup' },
  'mfa/enable': { method: 'POST', path: '/auth/mfa/enable' },
  'mfa/disable': { method: 'POST', path: '/auth/mfa/disable' },
};

async function proxySecurityRequest(
  request: NextRequest,
  context: { params: { path: string[] } },
  method: 'GET' | 'POST',
) {
  const endpoint = endpoints[context.params.path.join('/')];
  if (!endpoint || endpoint.method !== method) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  try {
    const authHeader = request.headers.get('authorization');
    const response = await fetchBackend(endpoint.path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader || '',
      },
      ...(method === 'POST' ? { body: JSON.stringify(await request.json()) } : {}),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.isBackendUnreachable) {
      return NextResponse.json({ message: 'Backend service is unavailable' }, { status: 503 });
    }
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export function GET(request: NextRequest, context: { params: { path: string[] } }) {
  return proxySecurityRequest(request, context, 'GET');
}

export function POST(request: NextRequest, context: { params: { path: string[] } }) {
  return proxySecurityRequest(request, context, 'POST');
}