import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';

export interface CurrentUserProfile {
  id: string;
  email: string;
  role: UserRole;
  kycStatus: User['kycStatus'];
  walletAddress: string | null;
  isCompany: boolean;
  companyDetails: User['companyDetails'];
  country: string;
  createdAt: Date;
}

export type DashboardDealRole = 'farmer' | 'trader';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepository: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepository: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepository: Repository<ShipmentMilestone>,
    @InjectRepository(PaymentDistribution)
    private readonly paymentDistributionRepository: Repository<PaymentDistribution>,
  ) {}

  async getProfile(userId: string): Promise<CurrentUserProfile> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      kycStatus: user.kycStatus,
      walletAddress: user.walletAddress,
      isCompany: user.isCompany,
      companyDetails: user.companyDetails,
      country: user.country,
      createdAt: user.createdAt,
    };
  }

  async getUserDeals(
    userId: string,
    userRole: DashboardDealRole,
  ): Promise<any[]> {
    if (userRole !== 'farmer' && userRole !== 'trader') {
      throw new ForbiddenException(
        'Only farmers and traders can access deals endpoint',
      );
    }

    const whereCondition =
      userRole === 'farmer' ? { farmerId: userId } : { traderId: userId };

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
      throw new ForbiddenException(
        'Only investors can access investments endpoint',
      );
    }

    const investments = await this.investmentRepository.find({
      where: { investorId: userId },
      relations: ['tradeDeal'],
    });

    return Promise.all(
      investments.map(async (investment) => {
        const deal = investment.tradeDeal;
        const totalTokens = Number(deal.tokenCount);
        const totalValue = Number(deal.totalValue);
        const tokenAmount = Number(investment.tokenAmount);

        const expected_return_usd =
          totalTokens > 0 ? (tokenAmount / totalTokens) * totalValue : 0;

        let actual_return_usd: number | null = null;
        let return_percentage: number | null = null;

        if (deal.status === 'completed') {
          const distribution = await this.paymentDistributionRepository.findOne(
            {
              where: {
                tradeDealId: deal.id,
                recipientId: userId,
                recipientType: 'investor',
                status: 'confirmed',
              },
            },
          );

          if (distribution) {
            actual_return_usd = Number(distribution.amountUsd);
            const amountUsd = Number(investment.amountUsd);
            return_percentage =
              amountUsd > 0
                ? ((actual_return_usd - amountUsd) / amountUsd) * 100
                : null;
          }
        }

        return {
          id: investment.id,
          token_amount: tokenAmount,
          amount_usd: Number(investment.amountUsd),
          status: investment.status,
          stellar_tx_id: investment.stellarTxId,
          created_at: investment.createdAt,
          expected_return_usd,
          actual_return_usd,
          return_percentage,
          deal: {
            commodity: deal.commodity,
            status: deal.status,
            total_value: totalValue,
            token_count: totalTokens,
          },
        };
      }),
    );
  }

  async deleteAccount(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    // Check for active trade deals as farmer or trader
    const activeStatuses = ['draft', 'open', 'funded', 'delivered'];
    const activeDeal = await this.tradeDealRepository.findOne({
      where: [
        { farmerId: userId, status: In(activeStatuses) as any },
        { traderId: userId, status: In(activeStatuses) as any },
      ],
    });
    if (activeDeal) {
      throw new ConflictException(
        'Cannot delete account with active trade deals.',
      );
    }

    // Check for unresolved investments (pending or confirmed on active deals)
    const unresolvedInvestment = await this.investmentRepository.findOne({
      where: { investorId: userId, status: In(['pending', 'confirmed']) as any },
    });
    if (unresolvedInvestment) {
      throw new ConflictException(
        'Cannot delete account with unresolved investments.',
      );
    }

    // Anonymize PII
    const hash = randomBytes(8).toString('hex');
    user.email = `deleted-${hash}@anon.invalid`;
    user.walletAddress = null;
    user.companyDetails = null;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1; // invalidate sessions
    await this.userRepository.save(user);

    // Soft-delete
    await this.userRepository.softDelete(userId);

    return { message: 'Account anonymized and scheduled for deletion.' };
  }
}
