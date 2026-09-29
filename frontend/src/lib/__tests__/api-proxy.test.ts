import { NextRequest } from 'next/server';
import { withBackendProxy } from '../api-proxy';

const { fetchBackend } = vi.hoisted(() => ({ fetchBackend: vi.fn() }));

vi.mock('@/config/backend', () => ({
  fetchBackend,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRequest(
  url = 'http://localhost/api/example',
  init?: RequestInit,
): NextRequest {
  return new NextRequest(url, init);
}

describe('withBackendProxy', () => {
  beforeEach(() => {
    fetchBackend.mockReset();
  });

  it('passes a successful backend response straight through', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({ ok: true, id: '1' }, 200));

    const handler = withBackendProxy(async () => ({ path: '/things' }));
    const response = await handler(makeRequest(), { params: {} });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true, id: '1' });
    expect(fetchBackend).toHaveBeenCalledWith(
      '/things',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps an unreachable backend to a 503', async () => {
    fetchBackend.mockRejectedValue({ isBackendUnreachable: true, originalError: new Error('ECONNREFUSED') });

    const handler = withBackendProxy(async () => ({ path: '/things' }));
    const response = await handler(makeRequest(), { params: {} });
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({ message: 'Backend service is unavailable' });
  });

  it('maps any other thrown error to a 500', async () => {
    fetchBackend.mockRejectedValue(new Error('boom'));

    const handler = withBackendProxy(async () => ({ path: '/things' }));
    const response = await handler(makeRequest(), { params: {} });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ message: 'Internal server error' });
  });

  it('passes through a non-200 backend response with its status and body', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({ message: 'Not found' }, 404));

    const handler = withBackendProxy(async () => ({ path: '/things/missing' }));
    const response = await handler(makeRequest(), { params: {} });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ message: 'Not found' });
  });

  it('honors a custom success status override', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({ id: 'new-1' }, 200));

    const handler = withBackendProxy(async () => ({
      path: '/things',
      method: 'POST',
      status: 201,
    }));
    const response = await handler(makeRequest(), { params: {} });

    expect(response.status).toBe(201);
  });

  it('defaults the success status to whatever the backend returned', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({ id: 'new-1' }, 201));

    const handler = withBackendProxy(async () => ({ path: '/things', method: 'POST' }));
    const response = await handler(makeRequest(), { params: {} });

    expect(response.status).toBe(201);
  });

  it('forwards the caller Authorization header to the backend by default', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({ path: '/protected' }));
    await handler(
      makeRequest('http://localhost/api/protected', {
        headers: { authorization: 'Bearer my-jwt' },
      }),
      { params: {} },
    );

    expect(fetchBackend).toHaveBeenCalledWith(
      '/protected',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-jwt' }),
      }),
    );
  });

  it('sends an empty Authorization header when none was supplied and forwarding is on', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({ path: '/protected' }));
    await handler(makeRequest('http://localhost/api/protected'), { params: {} });

    expect(fetchBackend).toHaveBeenCalledWith(
      '/protected',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: '' }) }),
    );
  });

  it('does not forward Authorization when forwardAuth is false', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({ path: '/public', forwardAuth: false }));
    await handler(
      makeRequest('http://localhost/api/public', {
        headers: { authorization: 'Bearer my-jwt' },
      }),
      { params: {} },
    );

    const [, options] = fetchBackend.mock.calls[0];
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('does not override an Authorization header explicitly set by the handler', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({
      path: '/impersonate',
      headers: { Authorization: 'Bearer service-token' },
    }));
    await handler(
      makeRequest('http://localhost/api/impersonate', {
        headers: { authorization: 'Bearer caller-jwt' },
      }),
      { params: {} },
    );

    expect(fetchBackend).toHaveBeenCalledWith(
      '/impersonate',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer service-token' }),
      }),
    );
  });

  it('JSON-stringifies a non-string body', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({
      path: '/things',
      method: 'POST',
      body: { name: 'demo' },
    }));
    await handler(makeRequest('http://localhost/api/things', { method: 'POST' }), { params: {} });

    const [, options] = fetchBackend.mock.calls[0];
    expect(options.body).toBe(JSON.stringify({ name: 'demo' }));
  });

  it('leaves an already-stringified body untouched', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));
    const raw = JSON.stringify({ name: 'demo' });

    const handler = withBackendProxy(async () => ({
      path: '/things',
      method: 'POST',
      body: raw,
    }));
    await handler(makeRequest('http://localhost/api/things', { method: 'POST' }), { params: {} });

    const [, options] = fetchBackend.mock.calls[0];
    expect(options.body).toBe(raw);
  });

  it('defaults the outgoing method to the incoming request method', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async () => ({ path: '/things' }));
    await handler(makeRequest('http://localhost/api/things', { method: 'PATCH' }), { params: {} });

    expect(fetchBackend).toHaveBeenCalledWith('/things', expect.objectContaining({ method: 'PATCH' }));
  });

  it('passes dynamic route params through to the handler', async () => {
    fetchBackend.mockResolvedValue(jsonResponse({}, 200));

    const handler = withBackendProxy(async (_request, { params }: { params: { id: string } }) => ({
      path: `/things/${params.id}`,
    }));
    await handler(makeRequest(), { params: { id: 'abc-123' } });

    expect(fetchBackend).toHaveBeenCalledWith('/things/abc-123', expect.anything());
  });
});
