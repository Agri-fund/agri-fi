import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from '../api-key.service';

describe('ApiKeyGuard (Issue #1014)', () => {
  let guard: ApiKeyGuard;
  let apiKeyService: jest.Mocked<Partial<ApiKeyService>>;
  let reflector: jest.Mocked<Partial<Reflector>>;

  beforeEach(() => {
    apiKeyService = {
      validateKey: jest.fn(),
    };
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new ApiKeyGuard(apiKeyService as any, reflector as any);
  });

  function createMockContext(headers: Record<string, string>): ExecutionContext {
    const req = { headers, apiKey: null, user: null };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  it('throws UnauthorizedException if no API key header is present', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('validates key and permits access when scopes match', async () => {
    const context = createMockContext({ 'x-api-key': 'agfi_live_1234567890abcdef' });
    const mockApiKey: any = {
      id: 'key-uuid-1',
      ownerId: 'user-uuid-1',
      scopes: ['read:deals', 'webhook:manage'],
      revokedAt: null,
    };

    (apiKeyService.validateKey as jest.Mock).mockResolvedValue(mockApiKey);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['read:deals']);

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);

    const req = context.switchToHttp().getRequest();
    expect(req.apiKey).toBe(mockApiKey);
    expect(req.user.id).toBe('user-uuid-1');
  });

  it('throws ForbiddenException if API key lacks required scope', async () => {
    const context = createMockContext({ 'x-api-key': 'agfi_live_1234567890abcdef' });
    const mockApiKey: any = {
      id: 'key-uuid-1',
      ownerId: 'user-uuid-1',
      scopes: ['read:deals'], // lacks 'webhook:manage'
      revokedAt: null,
    };

    (apiKeyService.validateKey as jest.Mock).mockResolvedValue(mockApiKey);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['webhook:manage']);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('supports Bearer token authorization header format', async () => {
    const context = createMockContext({ authorization: 'Bearer agfi_live_bearerkey12345' });
    const mockApiKey: any = {
      id: 'key-uuid-2',
      ownerId: 'user-uuid-2',
      scopes: ['read:deals'],
    };

    (apiKeyService.validateKey as jest.Mock).mockResolvedValue(mockApiKey);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
    expect(apiKeyService.validateKey).toHaveBeenCalledWith('agfi_live_bearerkey12345');
  });
});
