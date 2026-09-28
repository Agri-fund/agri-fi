import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

describe('ApiKeyThrottlerGuard (Issue #1014)', () => {
  let guard: ApiKeyThrottlerGuard;

  beforeEach(() => {
    guard = new ApiKeyThrottlerGuard(
      {
        getOptions: jest.fn().mockReturnValue([{ name: 'default', ttl: 60000, limit: 120 }]),
      } as any,
      {} as any,
      {} as any,
    );
  });

  it('uses API key ID as tracker bucket when authenticated', async () => {
    const req = {
      apiKey: { id: 'key-uuid-123' },
      ip: '192.168.1.1',
    };

    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('apikey:key-uuid-123');
  });

  it('falls back to header prefix when apiKey object is not yet populated', async () => {
    const req = {
      headers: { 'x-api-key': 'agfi_live_3f9a1234567890' },
      ip: '192.168.1.1',
    };

    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('apikey:agfi_live_3f9');
  });

  it('uses user ID tracker when JWT user is authenticated', async () => {
    const req = {
      user: { id: 'user-uuid-999' },
      ip: '192.168.1.1',
    };

    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('user:user-uuid-999');
  });

  it('falls back to IP address for unauthenticated requests', async () => {
    const req = {
      ip: '203.0.113.195',
      headers: {},
    };

    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('203.0.113.195');
  });
});
