/**
 * Shipments Resolver.
 *
 * Exposes:
 *  - Query.shipments(tradeDealId) — list milestones for a deal
 *
 * The `tradeDeal` field on each milestone is resolved via the DealDataLoader
 * to prevent N+1 queries.
 *
 * Authentication: GqlAuthGuard (JWT Bearer)
 */
import {
  Resolver,
  Query,
  Args,
  ID,
  ResolveField,
  Parent,
  Context,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentMilestone } from '../../shipments/entities/shipment-milestone.entity';
import { GqlShipmentMilestone, GqlTradeDeal } from '../graphql.types';
import { GqlAuthGuard } from '../graphql.auth.guard';
import type { GqlContext } from '../graphql.module';
import { mapMilestone } from './deals.resolver';

@Resolver(() => GqlShipmentMilestone)
@UseGuards(GqlAuthGuard)
export class ShipmentsResolver {
  constructor(
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
  ) {}

  @Query(() => [GqlShipmentMilestone], {
    name: 'shipments',
    description: 'List all shipment milestones for a given trade deal.',
  })
  async shipments(
    @Args('tradeDealId', { type: () => ID }) tradeDealId: string,
  ): Promise<GqlShipmentMilestone[]> {
    const entities = await this.milestoneRepo.find({
      where: { tradeDealId },
      order: { recordedAt: 'ASC' },
    });
    return entities.map(mapMilestone);
  }

  @ResolveField(() => GqlTradeDeal, {
    name: 'tradeDeal',
    nullable: true,
    description: 'The trade deal this milestone belongs to.',
  })
  async resolveTradeDeal(
    @Parent() milestone: GqlShipmentMilestone,
    @Context() ctx: GqlContext,
  ): Promise<GqlTradeDeal | null> {
    return ctx.loaders.deal.load(milestone.tradeDealId);
  }
}
