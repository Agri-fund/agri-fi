/**
 * GraphQL Throttler Guard.
 *
 * Extends the standard ThrottlerGuard to:
 *  1. Extract the HTTP request from the GraphQL execution context.
 *  2. Key rate-limit buckets on the JWT `sub` claim when the request is
 *     authenticated, falling back to the client IP for unauthenticated calls.
 *
 * This ensures that a single investor cannot hammer subscriptions or
 * expensive queries in a way that degrades service for others.
 */
import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  /**
   * Pull the raw Express request from the GraphQL context so the base
   * ThrottlerGuard can read IP, headers, etc.
   */
  protected getRequestResponse(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    const gqlCtx = ctx.getContext<{ req: any; res: any }>();
    return { req: gqlCtx.req, res: gqlCtx.res };
  }

  /**
   * Use the JWT `sub` (user ID) as the throttle tracker key when available.
   * Falls back to the parent implementation (IP-based) for unauthenticated
   * requests so the playground and introspection are still rate-limited.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId: string | undefined = req?.user?.id ?? req?.user?.sub;
    if (userId) {
      return `gql:user:${userId}`;
    }
    return super.getTracker(req);
  }
}
