/**
 * PubSub provider token and factory.
 *
 * The PubSub instance is provided as a NestJS token so it can be injected
 * into resolvers and services that publish subscription events.
 *
 * In production you would swap this for a Redis-backed PubSub (e.g.
 * graphql-redis-subscriptions) to support multi-process deployments.
 */
import { PubSub } from 'graphql-subscriptions';

export const GQL_PUB_SUB = 'GQL_PUB_SUB';

/** Subscription event names — use these constants everywhere to avoid typos. */
export const SUBSCRIPTION_EVENTS = {
  DEAL_FUNDING_UPDATED: 'dealFundingUpdated',
  PAYMENT_DISTRIBUTED: 'paymentDistributed',
} as const;

export const pubSubProvider = {
  provide: GQL_PUB_SUB,
  useFactory: () => new PubSub(),
};
