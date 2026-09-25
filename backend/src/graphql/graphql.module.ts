/**
 * GraphQL Module.
 *
 * Registers Apollo Server with:
 *  - Code-first schema (ObjectType decorators in graphql.types.ts)
 *  - Depth limit (max 5 levels)
 *  - Query complexity limit (max 200)
 *  - Introspection disabled in production
 *  - Apollo Playground disabled in production
 *  - Per-request DataLoader context (user + deal loaders)
 *  - WebSocket subscriptions via graphql-ws
 *
 * The module imports all domain modules that provide the TypeORM repositories
 * and services required by the resolvers, without creating circular imports.
 */
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { TypeOrmModule } from '@nestjs/typeorm';
import depthLimit from 'graphql-depth-limit';
import { complexityLimitRule, MAX_COMPLEXITY } from './graphql.complexity.plugin';

// ── Entities ──────────────────────────────────────────────────────────────────
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';

// ── DataLoaders ───────────────────────────────────────────────────────────────
import { UserDataLoaderService, UserDataLoaderType } from './dataloaders/user.dataloader';
import { DealDataLoaderService, DealDataLoaderType } from './dataloaders/deal.dataloader';

// ── Resolvers ─────────────────────────────────────────────────────────────────
import { DealsResolver } from './resolvers/deals.resolver';
import { InvestmentsResolver } from './resolvers/investments.resolver';
import { UsersResolver } from './resolvers/users.resolver';
import { ShipmentsResolver } from './resolvers/shipments.resolver';
import { SubscriptionsResolver } from './resolvers/subscriptions.resolver';

// ── Auth ──────────────────────────────────────────────────────────────────────
import { GqlAuthGuard } from './graphql.auth.guard';
import { GqlThrottlerGuard } from './graphql.throttler.guard';

// ── PubSub ────────────────────────────────────────────────────────────────────
import { pubSubProvider } from './graphql.pubsub';

// ── Domain service modules ────────────────────────────────────────────────────
import { AuthModule } from '../auth/auth.module';
import { InvestmentsModule } from '../investments/investments.module';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Shape of the per-request GraphQL context object.
 * Available in all resolvers via @Context().
 */
export interface GqlContext {
  req: any;
  res: any;
  loaders: {
    user: UserDataLoaderType;
    deal: DealDataLoaderType;
  };
}

@Module({
  imports: [
    // TypeORM repositories needed by the DataLoaders and resolvers.
    TypeOrmModule.forFeature([User, TradeDeal, Investment, ShipmentMilestone]),

    // Domain modules that expose services consumed by the resolvers.
    AuthModule,
    InvestmentsModule,

    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [UserDataLoaderService, DealDataLoaderService],
      useFactory: (
        userLoaderService: UserDataLoaderService,
        dealLoaderService: DealDataLoaderService,
      ): ApolloDriverConfig => ({
        // Code-first: auto-generate schema from TypeScript decorators.
        autoSchemaFile: true,

        // Serve the GraphQL endpoint at /graphql.
        path: '/graphql',

        // Subscriptions via graphql-ws (modern WebSocket protocol).
        subscriptions: {
          'graphql-ws': {
            onConnect: () => {
              // Connection-level auth is handled per-operation by GqlAuthGuard.
              return true;
            },
          },
        },

        // Disable Apollo Playground and introspection in production.
        playground: !IS_PRODUCTION,
        introspection: !IS_PRODUCTION,

        // Validation rules: depth limit + complexity limit.
        validationRules: [
          depthLimit(5),
          complexityLimitRule(MAX_COMPLEXITY),
        ],

        // Per-request context: attach DataLoader instances.
        // New loaders are created for every request so there is no
        // cross-request cache leakage.
        context: ({ req, res }: { req: any; res: any }): GqlContext => ({
          req,
          res,
          loaders: {
            user: userLoaderService.createLoader(),
            deal: dealLoaderService.createLoader(),
          },
        }),

        // Include stack traces in errors only during development.
        formatError: (error) => {
          if (IS_PRODUCTION) {
            // Strip internal stack traces from production responses.
            const { extensions, message, locations, path } = error;
            return {
              message,
              locations,
              path,
              extensions: extensions
                ? { code: extensions['code'] }
                : undefined,
            };
          }
          return error;
        },
      }),
    }),
  ],

  providers: [
    // DataLoader services (created per-module, shared via context).
    UserDataLoaderService,
    DealDataLoaderService,

    // Resolvers.
    DealsResolver,
    InvestmentsResolver,
    UsersResolver,
    ShipmentsResolver,
    SubscriptionsResolver,

    // Guards.
    GqlAuthGuard,
    GqlThrottlerGuard,

    // PubSub for subscriptions.
    pubSubProvider,
  ],

  exports: [
    // Export PubSub so other modules (e.g. EscrowService) can publish events.
    pubSubProvider,
    GqlAuthGuard,
  ],
})
export class GraphQLApiModule {}
