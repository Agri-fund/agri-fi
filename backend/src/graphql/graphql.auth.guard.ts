/**
 * GraphQL Auth Guard.
 *
 * Reuses the existing Passport JWT strategy (`jwt`) so all token validation
 * logic (blocklist, token version, refresh-token rejection) is centralised
 * in JwtStrategy.  The guard extracts the HTTP request from the GraphQL
 * execution context so Passport can read the Authorization header normally.
 */
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  /**
   * Transform the NestJS GraphQL execution context into a plain HTTP request
   * so Passport's JWT strategy can locate the Authorization header.
   */
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    const { req } = ctx.getContext<{ req: Request }>();
    return req;
  }
}
