import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../auth/entities/user.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepository: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepository: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepository: Repository<ShipmentMilestone>,
  ) {}

  async getUserDeals(userId: string, userRole: UserRole): Promise<any[]> {
    if (userRole === 'investor') {
      throw new ForbiddenException('Investors cannot access deals endpoint');
    }

    const whereCondition = userRole === 'farmer' 
      ? { farmerId: userId }
      : { traderId: userId };

    const deals = await this.tradeDealRepository.find({
      where: whereCondition,
      relations: ['farmer', 'trader', 'milestones'],
    });

    // Get document count for each deal (placeholder - would need documents entity)
    const dealsWithCounts = await Promise.all(
      deals.map(async (deal) => {
        const latestMilestone = await this.milestoneRepository.findOne({
          where: { tradeDealId: deal.id },
          order: { recordedAt: 'DESC' },
        });

        return {
          id: deal.id,
          commodity: deal.commodity,
          quantity: deal.quantity,
          total_value: deal.totalValue,
          total_invested: deal.totalInvested,
          status: deal.status,
          delivery_date: deal.deliveryDate,
          latest_milestone: latestMilestone || null,
          document_count: 0, // TODO: Implement when documents entity is available
        };
      }),
    );

    return dealsWithCounts;
  }

  async getUserInvestments(userId: string, userRole: UserRole): Promise<any[]> {
    if (userRole !== 'investor') {
      throw new ForbiddenException('Only investors can access investments endpoint');
    }

    const investments = await this.investmentRepository.find({
      where: { investorId: userId },
      relations: ['tradeDeal'],
    });

    return investments.map((investment) => ({
      id: investment.id,
      token_amount: investment.tokenAmount,
      amount_usd: investment.amountUsd,
      status: investment.status,
      stellar_tx_id: investment.stellarTxId,
      deal: {
        commodity: investment.tradeDeal.commodity,
        status: investment.tradeDeal.status,
        total_value: investment.tradeDeal.totalValue,
      },
    }));
  }
}
