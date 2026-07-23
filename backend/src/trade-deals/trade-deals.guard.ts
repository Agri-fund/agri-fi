import {
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
  params?: { id?: string };
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
    const id = req.params?.id;

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

    const isPublicDeal = ['open', 'funded', 'delivered', 'completed'].includes(
      deal.status,
    );
    const canViewSensitive = isOwner || isAdmin || isInvestedInvestor;

    if (!isPublicDeal && !canViewSensitive) {
      throw new ForbiddenException({
        code: 'DEAL_ACCESS_DENIED',
        message: 'You do not have access to this trade deal.',
      });
    }

    req.tradeDealAccess = {
      isOwner: isOwner || isAdmin,
      isInvestedInvestor,
      canViewSensitive,
    };

    return true;
  }
}
