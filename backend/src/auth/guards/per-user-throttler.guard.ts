import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { ExtractJwt } from 'passport-jwt';

/**
 * Rate limits by authenticated user (JWT `sub`) instead of by IP (#790).
 *
 * The global `ThrottlerGuard` registered in `app.module.ts` is IP-based and
 * runs *before* route-level guards like `AuthGuard('jwt')` — global guards
 * execute ahead of controller/method guards in Nest's pipeline — so by the
 * time a route-level auth guard would populate `req.user`, the global
 * throttler has already made its tracking decision. That's fine for
 * genuinely pre-auth endpoints (login, register), but for endpoints the
 * caller can only reach *with* a token (refresh, change-password, kyc
 * submission), IP-only tracking means one abusive authenticated user can
 * exhaust the limit for everyone behind the same IP/NAT, and conversely
 * offers no protection once an attacker rotates IPs while reusing a stolen
 * token.
 *
 * This guard decodes the bearer token itself (mirroring `ws-jwt.guard.ts`'s
 * approach for the same "auth guard hasn't run yet" problem) rather than
 * relying on `req.user`, so it works regardless of guard ordering. Falls
 * back to IP-based tracking when no valid token is present — e.g. `/refresh`
 * is called with a *refresh* token in the body, not a bearer access token,
 * so it falls back to IP there, same as an unauthenticated caller.
 */
@Injectable()
export class PerUserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Bearer access token (change-password, kyc submission — both require
    // AuthGuard('jwt'), so a valid token is always present by the time a
    // legitimate caller reaches the route).
    const bearerToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req as any);
    // /auth/refresh has no access token yet — the caller's identity is the
    // refresh token itself, sent in the body (see RefreshTokenDto). Without
    // this, refresh would always fall through to IP tracking, silently
    // defeating per-user tracking for that endpoint.
    const bodyRefreshToken =
      typeof req.body?.refreshToken === 'string'
        ? req.body.refreshToken
        : undefined;

    for (const token of [bearerToken, bodyRefreshToken]) {
      if (!token) continue;
      try {
        const payload = this.jwtService.verify(token);
        if (payload?.sub) {
          return `user:${payload.sub}`;
        }
      } catch {
        // Invalid/expired token — try the next candidate, then fall through
        // to IP tracking. Actual auth enforcement is the route's job
        // (AuthGuard('jwt') / AuthService.refresh), not this guard's.
      }
    }
    return `ip:${req.ip}`;
  }

  /**
   * The base guard already sets a per-throttler `Retry-After-<name>` header
   * on breach (e.g. `Retry-After-sensitive`), which is correct for clients
   * that know to look for it but isn't the standard HTTP header most
   * clients/tools check. Also set the unsuffixed `Retry-After` (#790).
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse();
    const retryAfterMs =
      throttlerLimitDetail.timeToBlockExpire ?? throttlerLimitDetail.ttl;
    res.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
