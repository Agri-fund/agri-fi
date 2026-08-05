import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole, KycStatus } from '../../auth/entities/user.entity';

/**
 * Shape of the authenticated user payload attached to the request by JwtStrategy.
 * Mirrors the fields validated/returned from the JWT token and user lookup.
 */
export interface CurrentUserPayload {
  id: string;
  email: string;
  role: UserRole;
  country: string;
  kycStatus: KycStatus;
  walletAddress: string | null;
  isCompany: boolean;
  tokenVersion: number;
  isEmailVerified: boolean;
  createdAt: Date;
}

/**
 * @CurrentUser() — custom param decorator that extracts the authenticated user
 * (or a specific property of it) from the JWT-validated request.
 *
 * Usage:
 *   @CurrentUser()                  — returns the full user payload
 *   @CurrentUser('id')              — returns req.user.id (string)
 *   @CurrentUser('role')            — returns req.user.role
 *
 * The JWT guard (JwtAuthGuard) must be applied on the route for this
 * decorator to return a value; otherwise it returns undefined.
 *
 * @param key  Optional key of a specific property to extract from the user object.
 */
export const CurrentUser = createParamDecorator(
  (
    key: keyof CurrentUserPayload | undefined,
    ctx: ExecutionContext,
  ): CurrentUserPayload | CurrentUserPayload[keyof CurrentUserPayload] | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return key ? user[key] : user;
  },
);
