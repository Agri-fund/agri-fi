/**
 * Subscriptions Resolver.
 *
 * Exposes:
 *  - Subscription.dealFundingUpdated  — emitted when an investment is confirmed
 *  - Subscription.paymentDistributed  — emitted when escrow is released
 *
 * Clients must supply a valid JWT Bearer token in the WebSocket connection
 * parameters (connectionParams.Authorization) for authentication.
 *
 * Authentication: GqlAuthGuard (JWT Bearer)
 */
import { Resolver, Subscription, Args, ID } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import {
  GqlDealFundingUpdatedPayload,
  GqlPaymentDistributedPayload,
} from '../graphql.types';
import { GqlAuthGuard } from '../graphql.auth.guard';
import { GQL_PUB_SUB, SUBSCRIPTION_EVENTS } from '../graphql.pubsub';

@Resolver()
@UseGuards(GqlAuthGuard)
export class SubscriptionsResolver {
  constructor(@Inject(GQL_PUB_SUB) private readonly pubSub: PubSub) {}

  @Subscription(() => GqlDealFundingUpdatedPayload, {
    name: SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED,
    description:
      'Fires whenever a new investment is confirmed on a deal. ' +
      'Optionally filter to a single deal by providing `dealId`.',
    filter(payload: Record<string, GqlDealFundingUpdatedPayload>, variables: { dealId?: string }) {
      if (!variables.dealId) return true;
      return payload[SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED].dealId === variables.dealId;
    },
    resolve(payload: Record<string, GqlDealFundingUpdatedPayload>) {
      return payload[SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED];
    },
  })
  dealFundingUpdated(
    @Args('dealId', { type: () => ID, nullable: true }) _dealId?: string,
  ) {
    return this.pubSub.asyncIterator(SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED);
  }

  @Subscription(() => GqlPaymentDistributedPayload, {
    name: SUBSCRIPTION_EVENTS.PAYMENT_DISTRIBUTED,
    description:
      'Fires when escrow is released and payments are distributed to farmer and investors.',
    filter(
      payload: Record<string, GqlPaymentDistributedPayload>,
      variables: { dealId?: string },
    ) {
      if (!variables.dealId) return true;
      return payload[SUBSCRIPTION_EVENTS.PAYMENT_DISTRIBUTED].dealId === variables.dealId;
    },
    resolve(payload: Record<string, GqlPaymentDistributedPayload>) {
      return payload[SUBSCRIPTION_EVENTS.PAYMENT_DISTRIBUTED];
    },
  })
  paymentDistributed(
    @Args('dealId', { type: () => ID, nullable: true }) _dealId?: string,
  ) {
    return this.pubSub.asyncIterator(SUBSCRIPTION_EVENTS.PAYMENT_DISTRIBUTED);
  }
}
