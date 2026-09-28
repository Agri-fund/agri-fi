import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { TradeDeal } from './entities/trade-deal.entity';

export interface TradeDealAccessRequest {
  user?: User;
  params?: {
    id?: string;
    trade_deal_id?: string;
    tradeDealId?: string;
  };
  tradeDealAccess?: {
    isOwner: boolean;
    isInvestedInvestor: boolean;
    canViewSensitive: boolean;
  };
}

@Injectable()
export class TradeDealsGuard implements CanActivate {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TradeDealAccessRequest>();
    const id =
      req.params?.id || req.params?.trade_deal_id || req.params?.tradeDealId;

    if (!id) {
      throw new BadRequestException('Trade deal ID is required');
    }

    const deal = await this.tradeDealRepo.findOne({ where: { id } });
    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }

    const user = req.user;
    const isOwner =
      !!user && (deal.farmerId === user.id || deal.traderId === user.id);
    const isAdmin = user?.role === 'admin';
    let isInvestedInvestor = false;

    if (user?.role === 'investor') {
      const investmentCount = await this.investmentRepo.count({
        where: {
          tradeDealId: deal.id,
          investorId: user.id,
          status: InvestmentStatus.CONFIRMED,
        },
      });
      isInvestedInvestor = investmentCount > 0;
    }

    // Enforce that authenticated users can only access deals they own, have invested in, or are admin
    // Keep public marketplace (GET /trade-deals) open, but deal detail requires access
    if (user && !isOwner && !isAdmin && !isInvestedInvestor) {
      throw new ForbiddenException({
        code: 'DEAL_ACCESS_DENIED',
        message: 'You do not have access to this trade deal.',
      });
    }

    const canViewSensitive = isOwner || isAdmin || isInvestedInvestor;

    req.tradeDealAccess = {
      isOwner: isOwner || isAdmin,
      isInvestedInvestor,
      canViewSensitive,
    };

    return true;
  }
}
