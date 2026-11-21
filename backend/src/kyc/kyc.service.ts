import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { MoreThan, Repository } from 'typeorm';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

const EDD_SINGLE_TRANSACTION_USD = 50_000;
const EDD_30_DAY_VOLUME_USD = 100_000;
const EDD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class KycService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly notificationsService: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycService.name);
  }

  async checkEddTriggers(
    userId: string,
    transactionAmountUsd: number,
    includeTransactionInVolume = false,
  ): Promise<{ triggered: boolean; reasons: string[] }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`Cannot evaluate EDD triggers: user ${userId} not found`);
    }

    const cutoff = new Date(Date.now() - EDD_WINDOW_MS);
    const investments = await this.investmentRepo.find({
      where: { investorId: userId, createdAt: MoreThan(cutoff) },
      relations: ['tradeDeal', 'tradeDeal.farmer'],
    });
    const recentInvestments = investments.filter(
      (investment) =>
        !['cancelled', 'failed', 'refunded'].includes(investment.status),
    );
    const volumeUsd =
      recentInvestments.reduce(
        (total, investment) => total + Number(investment.amountUsd),
        0,
      ) + (includeTransactionInVolume ? transactionAmountUsd : 0);
    const countries = new Set(
      [
        user.country,
        ...recentInvestments.map(
          (investment) => investment.tradeDeal?.farmer?.country,
        ),
      ].filter((country): country is string => Boolean(country)),
    );

    const reasons: string[] = [];
    if (transactionAmountUsd > EDD_SINGLE_TRANSACTION_USD) {
      reasons.push('Single transaction exceeds $50,000');
    }
    if (volumeUsd > EDD_30_DAY_VOLUME_USD) {
      reasons.push('30-day transaction volume exceeds $100,000');
    }
    if (countries.size >= 3) {
      reasons.push('Transactions involve 3 or more countries in 30 days');
    }

    if (reasons.length === 0) {
      return { triggered: false, reasons };
    }

    const newlyTriggered = user.kycStatus !== 'EDD_REQUIRED';
    user.kycStatus = 'EDD_REQUIRED';
    user.kycEddReason = reasons.join('; ');
    user.kycEddTriggeredAt ??= new Date();
    await this.userRepo.save(user);

    if (newlyTriggered) {
      try {
        await this.notificationsService.sendEmail(
          user.email,
          'Additional identity verification required',
          `Your recent account activity requires enhanced due diligence. ${reasons.join('. ')}. Please submit updated KYC documents to continue investing.`,
          `<p>Your recent account activity requires enhanced due diligence.</p><p>${reasons.join('. ')}.</p><p>Please submit updated KYC documents to continue investing. New investments are paused until your documents are approved.</p>`,
        );
      } catch (error) {
        this.logger.error(
          {
            userId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to send EDD requirement email',
        );
      }
    }

    return { triggered: true, reasons };
  }

  async listEddQueue(): Promise<
    Array<{
      userId: string;
      email: string;
      country: string;
      reason: string | null;
      triggeredAt: Date | null;
      priority: 'high';
    }>
  > {
    const users = await this.userRepo.find({
      where: { kycStatus: 'EDD_REQUIRED' },
      order: { kycEddTriggeredAt: 'ASC' },
      select: {
        id: true,
        email: true,
        country: true,
        kycEddReason: true,
        kycEddTriggeredAt: true,
      },
    });
    return users.map((user) => ({
      userId: user.id,
      email: user.email,
      country: user.country,
      reason: user.kycEddReason,
      triggeredAt: user.kycEddTriggeredAt,
      priority: 'high',
    }));
  }
}
