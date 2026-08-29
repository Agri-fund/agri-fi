import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { PerUserThrottlerGuard } from './per-user-throttler.guard';

function makeExecutionContext(res: { header: jest.Mock }) {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
    }),
  } as any;
}

describe('PerUserThrottlerGuard', () => {
  let guard: PerUserThrottlerGuard;
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } });
    guard = new PerUserThrottlerGuard(
      {} as any,
      {} as any,
      new Reflector(),
      jwtService,
    );
  });

  describe('getTracker', () => {
    it('tracks by user id when a valid bearer access token is present', async () => {
      const token = jwtService.sign({ sub: 'user-42', typ: 'access' });
      const req = { headers: { authorization: `Bearer ${token}` }, ip: '1.2.3.4' };
      await expect((guard as any).getTracker(req)).resolves.toBe('user:user-42');
    });

    it('tracks by user id derived from a refresh token in the body when no bearer header is present', async () => {
      const token = jwtService.sign({ sub: 'user-99', typ: 'refresh' });
      const req = { headers: {}, body: { refreshToken: token }, ip: '5.6.7.8' };
      await expect((guard as any).getTracker(req)).resolves.toBe('user:user-99');
    });

    it('falls back to IP tracking when no token is present', async () => {
      const req = { headers: {}, ip: '9.9.9.9' };
      await expect((guard as any).getTracker(req)).resolves.toBe('ip:9.9.9.9');
    });

    it('falls back to IP tracking when the bearer token is invalid/expired', async () => {
      const req = {
        headers: { authorization: 'Bearer not-a-real-jwt' },
        ip: '10.10.10.10',
      };
      await expect((guard as any).getTracker(req)).resolves.toBe('ip:10.10.10.10');
    });

    it('prefers the bearer token over a body refresh token when both are present', async () => {
      const bearerToken = jwtService.sign({ sub: 'from-header' });
      const bodyToken = jwtService.sign({ sub: 'from-body' });
      const req = {
        headers: { authorization: `Bearer ${bearerToken}` },
        body: { refreshToken: bodyToken },
        ip: '1.1.1.1',
      };
      await expect((guard as any).getTracker(req)).resolves.toBe('user:from-header');
    });
  });

  describe('throwThrottlingException', () => {
    it('sets a standard, unsuffixed Retry-After header (in seconds) before throwing', async () => {
      const header = jest.fn();
      const context = makeExecutionContext({ header });

      await expect(
        (guard as any).throwThrottlingException(context, {
          limit: 10,
          ttl: 60000,
          key: 'k',
          tracker: 'user:1',
          totalHits: 11,
          timeToExpire: 30000,
          isBlocked: true,
          timeToBlockExpire: 45000,
        }),
      ).rejects.toBeInstanceOf(ThrottlerException);

      expect(header).toHaveBeenCalledWith('Retry-After', '45');
    });

    it('falls back to ttl when timeToBlockExpire is not provided', async () => {
      const header = jest.fn();
      const context = makeExecutionContext({ header });

      await expect(
        (guard as any).throwThrottlingException(context, {
          limit: 10,
          ttl: 60000,
          key: 'k',
          tracker: 'ip:1.2.3.4',
          totalHits: 11,
          timeToExpire: 30000,
          isBlocked: true,
        }),
      ).rejects.toBeInstanceOf(ThrottlerException);

      expect(header).toHaveBeenCalledWith('Retry-After', '60');
    });
  });
});
