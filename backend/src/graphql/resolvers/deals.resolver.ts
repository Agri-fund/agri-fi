/**
 * Deals Resolver.
 *
 * Exposes:
 *  - Query.deals    — list all visible trade deals
 *  - Query.deal(id) — fetch a single trade deal by UUID
 *
 * Nested `farmer`, `trader`, `investments`, and `milestones` fields are
 * resolved lazily using DataLoaders and child resolvers to avoid N+1 queries.
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
import { UseGuards, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { Investment } from '../../investments/entities/investment.entity';
import { ShipmentMilestone } from '../../shipments/entities/shipment-milestone.entity';
import { GqlTradeDeal, GqlUser, GqlInvestment, GqlShipmentMilestone } from '../graphql.types';
import { GqlAuthGuard } from '../graphql.auth.guard';
import type { UserDataLoaderType } from '../dataloaders/user.dataloader';
import type { GqlContext } from '../graphql.module';

@Resolver(() => GqlTradeDeal)
@UseGuards(GqlAuthGuard)
export class DealsResolver {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
  ) {}

  // ── Queries ──────────────────────────────────────────────────────────────

  @Query(() => [GqlTradeDeal], {
    name: 'deals',
    description: 'List all trade deals visible on the marketplace.',
  })
  async deals(): Promise<GqlTradeDeal[]> {
    const entities = await this.dealRepo.find({ order: { createdAt: 'DESC' } });
    return entities.map(mapDeal);
  }

  @Query(() => GqlTradeDeal, {
    name: 'deal',
    description: 'Fetch a single trade deal by its UUID.',
  })
  async deal(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<GqlTradeDeal> {
    const entity = await this.dealRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Trade deal ${id} not found.`);
    }
    return mapDeal(entity);
  }

  // ── Field resolvers (DataLoader-backed) ──────────────────────────────────

  @ResolveField(() => GqlUser, {
    name: 'farmer',
    nullable: true,
    description: 'The farmer who listed this deal.',
  })
  async resolveFarmer(
    @Parent() deal: GqlTradeDeal,
    @Context() ctx: GqlContext,
  ): Promise<GqlUser | null> {
    return ctx.loaders.user.load(deal.farmerId);
  }

  @ResolveField(() => GqlUser, {
    name: 'trader',
    nullable: true,
    description: 'The trader who manages this deal.',
  })
  async resolveTrader(
    @Parent() deal: GqlTradeDeal,
    @Context() ctx: GqlContext,
  ): Promise<GqlUser | null> {
    return ctx.loaders.user.load(deal.traderId);
  }

  @ResolveField(() => [GqlInvestment], {
    name: 'investments',
    nullable: true,
    description: 'All investments placed on this deal.',
  })
  async resolveInvestments(
    @Parent() deal: GqlTradeDeal,
  ): Promise<GqlInvestment[]> {
    const entities = await this.investmentRepo.find({
      where: { tradeDealId: deal.id },
      order: { createdAt: 'DESC' },
    });
    return entities.map(mapInvestment);
  }

  @ResolveField(() => [GqlShipmentMilestone], {
    name: 'milestones',
    nullable: true,
    description: 'Recorded shipment milestones for this deal.',
  })
  async resolveMilestones(
    @Parent() deal: GqlTradeDeal,
  ): Promise<GqlShipmentMilestone[]> {
    const entities = await this.milestoneRepo.find({
      where: { tradeDealId: deal.id },
      order: { recordedAt: 'ASC' },
    });
    return entities.map(mapMilestone);
  }
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

export function mapDeal(e: TradeDeal): GqlTradeDeal {
  return {
    id: e.id,
    commodity: e.commodity,
    title: e.title,
    description: e.description,
    quantity: Number(e.quantity),
    quantityUnit: e.quantityUnit,
    totalValue: Number(e.totalValue),
    expectedRoi: e.expectedRoi != null ? Number(e.expectedRoi) : null,
    durationDays: e.durationDays,
    tokenCount: e.tokenCount,
    tokenSymbol: e.tokenSymbol,
    status: e.status,
    farmerId: e.farmerId,
    traderId: e.traderId,
    escrowPublicKey: e.escrowPublicKey,
    issuerPublicKey: e.issuerPublicKey,
    totalInvested: Number(e.totalInvested),
    deliveryDate: e.deliveryDate,
    riskRating: e.riskRating,
    farmLocation: e.farmLocation,
    farmLatitude: e.farmLatitude != null ? Number(e.farmLatitude) : null,
    farmLongitude: e.farmLongitude != null ? Number(e.farmLongitude) : null,
    stellarAssetTxId: e.stellarAssetTxId,
    sorobanCampaignContractId: e.sorobanCampaignContractId,
    riskScore: e.riskScore != null ? Number(e.riskScore) : null,
    minLotSize: Number(e.minLotSize),
    lotStep: Number(e.lotStep),
    settlementStatus: e.settlementStatus,
    settlementTxHash: e.settlementTxHash,
    settledAt: e.settledAt,
    createdAt: e.createdAt,
    deletedAt: e.deletedAt,
  };
}

export function mapInvestment(e: Investment): GqlInvestment {
  return {
    id: e.id,
    tradeDealId: e.tradeDealId,
    investorId: e.investorId,
    tokenAmount: e.tokenAmount,
    amountUsd: Number(e.amountUsd),
    stellarTxId: e.stellarTxId,
    status: e.status,
    createdAt: e.createdAt,
    deletedAt: e.deletedAt,
  };
}

export function mapMilestone(e: ShipmentMilestone): GqlShipmentMilestone {
  return {
    id: e.id,
    tradeDealId: e.tradeDealId,
    milestone: e.milestone,
    recordedBy: e.recordedBy,
    notes: e.notes,
    stellarTxId: e.stellarTxId,
    memoText: e.memoText,
    latitude: e.latitude,
    longitude: e.longitude,
    recordedAt: e.recordedAt,
  };
}
