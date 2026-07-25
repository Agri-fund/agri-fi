import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';

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

function generateRandomString(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

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
    @InjectRepository(KycSubmission)
    private readonly kycSubmissionRepository: Repository<KycSubmission>,
    private readonly dataSource: DataSource,
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

  async deleteAccount(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found.');
      }

      // Anonymize user PII
      const anonymizedUser = manager.create(User, {
        id: user.id,
        email: `deleted-${generateRandomString(16)}@example.com`,
        passwordHash: generateRandomString(64),
        tokenVersion: user.tokenVersion + 1, // Invalidate all JWTs
        walletAddress: null,
        fullName: null,
        birthdate: null,
        taxId: null,
        isEmailVerified: false,
        emailVerificationToken: null,
        companyDetails: user.isCompany
          ? {
              companyName: `Deleted Company ${generateRandomString(8)}`,
              registrationNumber: null,
              articlesOfIncorporationUrl: null,
            }
          : null,
      });
      await manager.save(User, anonymizedUser);

      // Anonymize KYC submissions
      const kycSubmissions = await manager.find(KycSubmission, {
        where: { userId },
      });
      for (const kyc of kycSubmissions) {
        await manager.update(KycSubmission, kyc.id, {
          governmentIdUrl: null,
          proofOfAddressUrl: null,
          companyName: kyc.isCorporate
            ? `Deleted Company ${generateRandomString(8)}`
            : null,
          registrationNumber: null,
          businessLicenseUrl: null,
          articlesOfIncorporationUrl: null,
        });
      }

      // Soft delete the user
      await manager.softDelete(User, userId);
    });
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

  async exportUserData(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    // Get KYC submissions
    const kycSubmissions = await this.kycSubmissionRepository.find({
      where: { userId },
    });

    // Get trade deals (as farmer or trader)
    const tradeDeals = await this.tradeDealRepository.find({
      where: [{ farmerId: userId }, { traderId: userId }],
    });

    // Get investments
    const investments = await this.investmentRepository.find({
      where: { investorId: userId },
      relations: ['tradeDeal'],
    });

    // Get shipment milestones for user's deals
    const dealIds = tradeDeals.map((d) => d.id);
    const milestones = await this.milestoneRepository.find({
      where: { tradeDealId: dealIds as any },
    });

    // Get payment distributions
    const paymentDistributions = await this.paymentDistributionRepository.find({
      where: { recipientId: userId },
    });

    return {
      profile: {
        id: user.id,
        email: user.email,
        role: user.role,
        country: user.country,
        kycStatus: user.kycStatus,
        walletAddress: user.walletAddress,
        isCompany: user.isCompany,
        companyDetails: user.companyDetails,
        createdAt: user.createdAt,
      },
      kycSubmissions: kycSubmissions.map((kyc) => ({
        id: kyc.id,
        status: kyc.status,
        isCorporate: kyc.isCorporate,
        companyName: kyc.companyName,
        registrationNumber: kyc.registrationNumber,
        createdAt: kyc.createdAt,
      })),
      tradeDeals: tradeDeals.map((deal) => ({
        id: deal.id,
        commodity: deal.commodity,
        quantity: deal.quantity,
        quantityUnit: deal.quantityUnit,
        totalValue: deal.totalValue,
        status: deal.status,
        deliveryDate: deal.deliveryDate,
        createdAt: deal.createdAt,
      })),
      investments: investments.map((inv) => ({
        id: inv.id,
        tokenAmount: inv.tokenAmount,
        amountUsd: inv.amountUsd,
        status: inv.status,
        stellarTxId: inv.stellarTxId,
        tradeDealId: inv.tradeDealId,
        createdAt: inv.createdAt,
      })),
      shipmentMilestones: milestones.map((ms) => ({
        id: ms.id,
        tradeDealId: ms.tradeDealId,
        milestone: ms.milestone,
        recordedBy: ms.recordedBy,
        notes: ms.notes,
        recordedAt: ms.recordedAt,
      })),
      paymentDistributions: paymentDistributions.map((pd) => ({
        id: pd.id,
        tradeDealId: pd.tradeDealId,
        recipientType: pd.recipientType,
        amountUsd: pd.amountUsd,
        status: pd.status,
        createdAt: pd.createdAt,
      })),
      exportedAt: new Date().toISOString(),
    };
  }
}
