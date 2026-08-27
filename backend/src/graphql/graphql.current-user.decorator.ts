/**
 * @GqlCurrentUser() — param decorator for GraphQL resolvers.
 *
 * Extracts the authenticated user from the GraphQL execution context
 * (populated by GqlAuthGuard after JwtStrategy validates the Bearer token).
 *
 * Usage in a resolver:
 *   @Query(() => GqlUser)
 *   me(@GqlCurrentUser() user: User) { ... }
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { User } from '../../auth/entities/user.entity';

export const GqlCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User | undefined => {
    const gqlCtx = GqlExecutionContext.create(ctx);
    const { req } = gqlCtx.getContext<{ req: any }>();
    return req?.user as User | undefined;
  },
);
