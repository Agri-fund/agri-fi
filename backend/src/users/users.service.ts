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
import { UpdateOnboardingProgressDto } from './dto/update-onboarding-progress.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { AuditLog } from '../database/entities/audit-log.entity';

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

export type ActivityEventType =
  | 'investment'
  | 'deal_created'
  | 'deal_status_change'
  | 'milestone'
  | 'document_upload'
  | 'payment'
  | 'kyc'
  | 'login'
  | 'account';

export interface ActivityLogItem {
  id: string;
  type: ActivityEventType;
  title: string;
  description: string;
  meta: Record<string, unknown>;
  created_at: string;
}

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
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
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

    // Get document count for each deal
    const dealsWithCounts = await Promise.all(
      deals.map(async (deal) => {
        const latestMilestone = await this.milestoneRepository.findOne({
          where: { tradeDealId: deal.id },
          order: { recordedAt: 'DESC' },
        });

        const documentCount = await this.documentRepository.count({
          where: { tradeDealId: deal.id },
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
          document_count: documentCount,
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

  /**
   * Synthesises a chronological activity feed for the user by merging events
   * from: investments, trade deals, shipment milestones, documents, KYC
   * submissions, payment distributions, and the audit_logs table.
   *
   * Returns the most recent `limit` events, sorted newest-first.
   */
  async getActivityLog(
    userId: string,
    limit = 50,
  ): Promise<ActivityLogItem[]> {
    const events: ActivityLogItem[] = [];

    // ── Investments ────────────────────────────────────────────────────────
    const investments = await this.investmentRepository.find({
      where: { investorId: userId },
      relations: ['tradeDeal'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    for (const inv of investments) {
      events.push({
        id: `inv-${inv.id}`,
        type: 'investment',
        title: 'Investment made',
        description: `Invested $${Number(inv.amountUsd).toLocaleString()} in ${inv.tradeDeal?.commodity ?? 'a trade deal'} (${inv.tradeDeal?.tokenSymbol ?? ''})`,
        meta: {
          investmentId: inv.id,
          dealId: inv.tradeDealId,
          commodity: inv.tradeDeal?.commodity,
          amountUsd: Number(inv.amountUsd),
          tokenAmount: Number(inv.tokenAmount),
          status: inv.status,
          stellarTxId: inv.stellarTxId,
        },
        created_at: inv.createdAt.toISOString(),
      });
    }

    // ── Trade deals created by this user ──────────────────────────────────
    const deals = await this.tradeDealRepository.find({
      where: [{ farmerId: userId }, { traderId: userId }],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    for (const deal of deals) {
      events.push({
        id: `deal-${deal.id}`,
        type: 'deal_created',
        title: 'Trade deal created',
        description: `Created trade deal for ${deal.commodity} — $${Number(deal.totalValue).toLocaleString()} (${deal.tokenSymbol})`,
        meta: {
          dealId: deal.id,
          commodity: deal.commodity,
          totalValue: Number(deal.totalValue),
          status: deal.status,
          tokenSymbol: deal.tokenSymbol,
        },
        created_at: deal.createdAt.toISOString(),
      });
    }

    // ── Shipment milestones recorded by this user ─────────────────────────
    const milestones = await this.milestoneRepository.find({
      where: { recordedBy: userId },
      order: { recordedAt: 'DESC' },
      take: limit,
    });
    for (const ms of milestones) {
      const milestoneLabels: Record<string, string> = {
        farm: 'Farm', warehouse: 'Warehouse', port: 'Port', importer: 'Importer',
      };
      events.push({
        id: `ms-${ms.id}`,
        type: 'milestone',
        title: 'Shipment milestone recorded',
        description: `Recorded "${milestoneLabels[ms.milestone] ?? ms.milestone}" milestone${ms.notes ? `: ${ms.notes}` : ''}`,
        meta: {
          milestoneId: ms.id,
          dealId: ms.tradeDealId,
          milestone: ms.milestone,
          notes: ms.notes,
          stellarTxId: ms.stellarTxId,
        },
        created_at: ms.recordedAt.toISOString(),
      });
    }

    // ── Document uploads ──────────────────────────────────────────────────
    const docs = await this.documentRepository.find({
      where: { uploaderId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    for (const doc of docs) {
      events.push({
        id: `doc-${doc.id}`,
        type: 'document_upload',
        title: 'Document uploaded',
        description: `Uploaded document of type "${doc.docType}"`,
        meta: {
          documentId: doc.id,
          docType: doc.docType,
          dealId: doc.tradeDealId,
          ipfsHash: doc.ipfsHash,
        },
        created_at: doc.createdAt.toISOString(),
      });
    }

    // ── KYC submissions ───────────────────────────────────────────────────
    const kycSubmissions = await this.kycSubmissionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    for (const kyc of kycSubmissions) {
      events.push({
        id: `kyc-${kyc.id}`,
        type: 'kyc',
        title: 'KYC submission',
        description: `KYC verification ${kyc.status === 'approved' ? 'approved' : kyc.status === 'rejected' ? 'rejected' : 'submitted'}`,
        meta: {
          kycId: kyc.id,
          status: kyc.status,
          isCorporate: kyc.isCorporate,
        },
        created_at: kyc.createdAt.toISOString(),
      });
    }

    // ── Payment distributions received ────────────────────────────────────
    const payments = await this.paymentDistributionRepository.find({
      where: { recipientId: userId, status: 'confirmed' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    for (const pd of payments) {
      events.push({
        id: `pay-${pd.id}`,
        type: 'payment',
        title: 'Payment received',
        description: `Received $${Number(pd.amountUsd).toLocaleString()} from escrow release (${pd.recipientType})`,
        meta: {
          paymentId: pd.id,
          dealId: pd.tradeDealId,
          amountUsd: Number(pd.amountUsd),
          recipientType: pd.recipientType,
          stellarTxId: pd.stellarTxId,
        },
        created_at: pd.createdAt.toISOString(),
      });
    }

    // ── Audit log entries attributed to this user ─────────────────────────
    const auditEntries = await this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    for (const entry of auditEntries) {
      // Skip TradeDeal mutations — already covered by deal_created above
      if (entry.entityName === 'TradeDeal') continue;
      events.push({
        id: `audit-${entry.id}`,
        type: 'account',
        title: `${entry.action.toLowerCase().replace('insert', 'created').replace('update', 'updated').replace('delete', 'deleted')} ${entry.entityName}`,
        description: entry.changes ?? `${entry.action} on ${entry.entityName}`,
        meta: {
          auditId: entry.id,
          entityName: entry.entityName,
          entityId: entry.entityId,
          action: entry.action,
        },
        created_at: entry.createdAt.toISOString(),
      });
    }

    // ── Sort all events newest-first and cap ──────────────────────────────
    events.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return events.slice(0, limit);
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

  /**
   * Returns the current onboarding progress for a farmer.
   * Always returns the four checklist fields (defaulting to false if null).
   */
  async getOnboardingProgress(userId: string): Promise<{
    profileComplete: boolean;
    kycSubmitted: boolean;
    firstDealCreated: boolean;
    walletConnected: boolean;
    allComplete: boolean;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const progress = user.onboardingProgress ?? {
      profileComplete: false,
      kycSubmitted: false,
      firstDealCreated: false,
      walletConnected: false,
    };

    const allComplete =
      progress.profileComplete &&
      progress.kycSubmitted &&
      progress.firstDealCreated &&
      progress.walletConnected;

    return { ...progress, allComplete };
  }

  /**
   * Merges a partial checklist update into the user's persisted
   * onboarding_progress column, then returns the full updated state.
   * Once all four steps are true, allComplete is set to true.
   */
  async updateOnboardingProgress(
    userId: string,
    dto: UpdateOnboardingProgressDto,
  ): Promise<{
    profileComplete: boolean;
    kycSubmitted: boolean;
    firstDealCreated: boolean;
    walletConnected: boolean;
    allComplete: boolean;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    // Start from the stored progress (or zeros) and apply the partial update
    const existing = user.onboardingProgress ?? {
      profileComplete: false,
      kycSubmitted: false,
      firstDealCreated: false,
      walletConnected: false,
    };

    const updated = {
      profileComplete:
        dto.profileComplete !== undefined
          ? dto.profileComplete
          : existing.profileComplete,
      kycSubmitted:
        dto.kycSubmitted !== undefined
          ? dto.kycSubmitted
          : existing.kycSubmitted,
      firstDealCreated:
        dto.firstDealCreated !== undefined
          ? dto.firstDealCreated
          : existing.firstDealCreated,
      walletConnected:
        dto.walletConnected !== undefined
          ? dto.walletConnected
          : existing.walletConnected,
    };

    user.onboardingProgress = updated;
    await this.userRepository.save(user);

    const allComplete =
      updated.profileComplete &&
      updated.kycSubmitted &&
      updated.firstDealCreated &&
      updated.walletConnected;

    return { ...updated, allComplete };
  }
}
