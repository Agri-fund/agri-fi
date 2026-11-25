import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Referral } from '../auth/entities/referral.entity';
import { ReferralCode } from '../auth/entities/referral-code.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';

const REFERRAL_CREDIT_AMOUNT = 5; // $5
const CREDIT_REWARD_LIMIT_PER_IP = 2; // Max 2 credits per IP/device

interface ReferralEventPayload {
  referralId: string;
  referrerId: string;
  referredUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Service for managing referral credit issuance logic.
 * Handles:
 * - Credit issuance when referred user completes KYC + first investment
 * - Fraud guard: IP/device deduplication
 * - Platform credit balance updates
 * - Email notifications
 */
@Injectable()
export class ReferralCreditService {
  private readonly logger = new Logger(ReferralCreditService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    @InjectRepository(ReferralCode)
    private readonly referralCodeRepo: Repository<ReferralCode>,
    private readonly notificationsService: NotificationsService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Generate an 8-character alphanumeric referral code.
   */
  generateReferralCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Create a referral code for a user.
   */
  async createReferralCode(userId: string): Promise<ReferralCode> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    // Generate unique code
    while (attempts < maxAttempts) {
      code = this.generateReferralCode();
      const existing = await this.referralCodeRepo.findOne({
        where: { code },
      });
      if (!existing) break;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique referral code');
    }

    const referralCode = this.referralCodeRepo.create({
      userId,
      code,
      usesCount: 0,
    });

    return this.referralCodeRepo.save(referralCode);
  }

  /**
   * Check fraud guard: has this IP/device already credited too many referrals?
   */
  async checkFraudGuard(ipAddress?: string): Promise<boolean> {
    if (!ipAddress) {
      // If no IP provided, skip fraud check
      return true;
    }

    // Count referrals where credit was issued from this IP
    const count = await this.referralRepo
      .createQueryBuilder('r')
      .where('r.ip_address = :ip', { ip: ipAddress })
      .andWhere('r.status = :status', { status: 'rewarded' })
      .andWhere('r.credit_issued_at IS NOT NULL')
      .getCount();

    return count < CREDIT_REWARD_LIMIT_PER_IP;
  }

  /**
   * Issue $5 platform credit to referrer when referred user completes first investment.
   * Includes fraud guard to prevent same IP/device from generating too many credits.
   */
  async issueCreditForFirstInvestment(
    payload: ReferralEventPayload,
  ): Promise<void> {
    const { referralId, referrerId, referredUserId, ipAddress, userAgent } =
      payload;

    this.logger.debug(
      `Processing referral credit for referral ${referralId}, referrer ${referrerId}`,
    );

    // Find the referral and referrer
    const referral = await this.referralRepo.findOne({
      where: { id: referralId },
    });

    if (!referral) {
      throw new BadRequestException(`Referral ${referralId} not found`);
    }

    // Check if credit already issued
    if (referral.creditIssuedAt) {
      this.logger.warn(
        `Credit already issued for referral ${referralId} at ${referral.creditIssuedAt}`,
      );
      return;
    }

    const referrer = await this.userRepo.findOne({
      where: { id: referrerId },
    });

    if (!referrer) {
      throw new BadRequestException(`Referrer ${referrerId} not found`);
    }

    // Fraud guard: check if IP has already generated max credits
    const passedFraudCheck = await this.checkFraudGuard(ipAddress);
    if (!passedFraudCheck) {
      this.logger.warn(
        `Fraud guard blocked referral ${referralId}: IP ${ipAddress} exceeded credit limit`,
      );
      referral.status = 'registered'; // Keep as registered, don't mark as rewarded
      await this.referralRepo.save(referral);
      return;
    }

    // Issue credit
    referral.status = 'rewarded';
    referral.rewardAmount = REFERRAL_CREDIT_AMOUNT;
    referral.payoutStatus = 'accrued';
    referral.creditIssuedAt = new Date();

    // Update referrer's platform credit balance
    referrer.platformCredit =
      (referrer.platformCredit ?? 0) + REFERRAL_CREDIT_AMOUNT;

    // Store IP and user agent for fraud tracking
    (referral as any).ip_address = ipAddress;
    (referral as any).user_agent = userAgent;

    // Increment referral code uses
    if (referral.referrer?.id) {
      const refCode = await this.referralCodeRepo.findOne({
        where: { userId: referral.referrer.id },
      });
      if (refCode) {
        refCode.usesCount = (refCode.usesCount ?? 0) + 1;
        await this.referralCodeRepo.save(refCode);
      }
    }

    await this.referralRepo.save(referral);
    await this.userRepo.save(referrer);

    this.logger.debug(
      `Credit issued: $${REFERRAL_CREDIT_AMOUNT} to referrer ${referrerId}`,
    );

    // Send email notification
    await this.notificationsService.sendReferralCreditEarnedEmail(referrer, {
      amount: REFERRAL_CREDIT_AMOUNT,
      referredUserEmail: (await this.userRepo.findOne({
        where: { id: referredUserId },
      }))?.email,
      creditIssuedAt: referral.creditIssuedAt,
    });
  }

  /**
   * Get referral summary for a user.
   */
  async getReferralSummary(
    userId: string,
  ): Promise<{
    code: string;
    codesCount: number;
    totalEarnings: number;
    creditsIssued: number;
    referralsSent: number;
  }> {
    // Get user's referral code(s)
    const codes = await this.referralCodeRepo.find({
      where: { userId },
    });

    if (codes.length === 0) {
      // Create a referral code if one doesn't exist
      const newCode = await this.createReferralCode(userId);
      codes.push(newCode);
    }

    // Get primary referral code (most recent or first)
    const primaryCode = codes.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    // Get referral stats
    const referrals = await this.referralRepo.find({
      where: { referrerId: userId },
    });

    const totalEarnings = referrals.reduce((sum, r) => {
      return sum + (Number(r.rewardAmount ?? 0) || 0);
    }, 0);

    const creditsIssued = referrals.filter(
      (r) => r.creditIssuedAt !== null,
    ).length;

    return {
      code: primaryCode.code,
      codesCount: codes.length,
      totalEarnings,
      creditsIssued,
      referralsSent: referrals.length,
    };
  }
}
