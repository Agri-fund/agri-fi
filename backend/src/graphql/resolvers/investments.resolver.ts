/**
 * Investments Resolver.
 *
 * Exposes:
 *  - Query.investments         — list the authenticated user's investments
 *  - Query.investment(id)      — fetch a single investment by UUID
 *  - Mutation.createInvestment — create a new investment (delegates to InvestmentsService)
 *  - Mutation.cancelInvestment — cancel / soft-delete an investment
 *
 * Subscription events for deal funding are published here after state changes
 * and consumed by the subscriptions resolver.
 *
 * Authentication: GqlAuthGuard (JWT Bearer)
 */
import {
  Resolver,
  Query,
  Mutation,
  Args,
  ID,
  ResolveField,
  Parent,
  Context,
} from '@nestjs/graphql';
import { UseGuards, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment, InvestmentStatus } from '../../investments/entities/investment.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { InvestmentsService } from '../../investments/investments.service';
import {
  GqlInvestment,
  GqlUser,
  GqlTradeDeal,
  GqlCreateInvestmentInput,
  GqlDealFundingUpdatedPayload,
} from '../graphql.types';
import { GqlAuthGuard } from '../graphql.auth.guard';
import { GqlCurrentUser } from '../graphql.current-user.decorator';
import { User } from '../../auth/entities/user.entity';
import { GQL_PUB_SUB, SUBSCRIPTION_EVENTS } from '../graphql.pubsub';
import { Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import type { GqlContext } from '../graphql.module';
import { mapDeal, mapInvestment } from './deals.resolver';

@Resolver(() => GqlInvestment)
@UseGuards(GqlAuthGuard)
export class InvestmentsResolver {
  private readonly logger = new Logger(InvestmentsResolver.name);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    private readonly investmentsService: InvestmentsService,
    @Inject(GQL_PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  // ── Queries ──────────────────────────────────────────────────────────────

  @Query(() => [GqlInvestment], {
    name: 'investments',
    description: 'List all investments belonging to the authenticated user.',
  })
  async investments(@CurrentUser() user: User): Promise<GqlInvestment[]> {
    const entities = await this.investmentRepo.find({
      where: { investorId: user.id },
      order: { createdAt: 'DESC' },
    });
    return entities.map(mapInvestment);
  }

  @Query(() => GqlInvestment, {
    name: 'investment',
    description: 'Fetch a single investment by UUID (must belong to the authenticated user).',
  })
  async investment(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<GqlInvestment> {
    const entity = await this.investmentRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Investment ${id} not found.`);
    }
    if (entity.investorId !== user.id) {
      throw new ForbiddenException('You do not own this investment.');
    }
    return mapInvestment(entity);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  @Mutation(() => GqlInvestment, {
    name: 'createInvestment',
    description: 'Create a new investment in a trade deal.',
  })
  async createInvestment(
    @Args('input') input: GqlCreateInvestmentInput,
    @CurrentUser() user: User,
  ): Promise<GqlInvestment> {
    const result = await this.investmentsService.createInvestment(user.id, {
      tradeDealId: input.tradeDealId,
      tokenAmount: input.tokenAmount,
      amountUsd: input.amountUsd,
      complianceData: input.complianceData,
    });

    const investment = mapInvestment(result.investment);

    // Publish a funding update so subscription subscribers receive it.
    const deal = await this.dealRepo.findOne({
      where: { id: input.tradeDealId },
    });
    if (deal) {
      const payload: GqlDealFundingUpdatedPayload = {
        dealId: deal.id,
        totalInvested: Number(deal.totalInvested),
        totalValue: Number(deal.totalValue),
        fundingPercentage:
          Number(deal.totalValue) > 0
            ? (Number(deal.totalInvested) / Number(deal.totalValue)) * 100
            : 0,
        status: deal.status,
      };

      await this.pubSub.publish(SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED, {
        [SUBSCRIPTION_EVENTS.DEAL_FUNDING_UPDATED]: payload,
      });
    }

    return investment;
  }

  @Mutation(() => GqlInvestment, {
    name: 'cancelInvestment',
    description: 'Cancel an investment that is still in PENDING or CONFIRMED status.',
  })
  async cancelInvestment(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<GqlInvestment> {
    const entity = await this.investmentRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Investment ${id} not found.`);
    }
    if (entity.investorId !== user.id) {
      throw new ForbiddenException('You do not own this investment.');
    }
    if (
      entity.status !== InvestmentStatus.PENDING &&
      entity.status !== InvestmentStatus.CONFIRMED
    ) {
      throw new ForbiddenException(
        `Cannot cancel an investment in ${entity.status} status.`,
      );
    }

    entity.status = InvestmentStatus.CANCELLED;
    const saved = await this.investmentRepo.save(entity);

    this.logger.log(
      `Investment ${id} cancelled by user ${user.id}`,
    );

    return mapInvestment(saved);
  }

  // ── Field resolvers (DataLoader-backed) ──────────────────────────────────

  @ResolveField(() => GqlUser, {
    name: 'investor',
    nullable: true,
    description: 'The investor who placed this investment.',
  })
  async resolveInvestor(
    @Parent() investment: GqlInvestment,
    @Context() ctx: GqlContext,
  ): Promise<GqlUser | null> {
    return ctx.loaders.user.load(investment.investorId);
  }

  @ResolveField(() => GqlTradeDeal, {
    name: 'tradeDeal',
    nullable: true,
    description: 'The trade deal this investment belongs to.',
  })
  async resolveTradeDeal(
    @Parent() investment: GqlInvestment,
    @Context() ctx: GqlContext,
  ): Promise<GqlTradeDeal | null> {
    return ctx.loaders.deal.load(investment.tradeDealId);
  }
}
