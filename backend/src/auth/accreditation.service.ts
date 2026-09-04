import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { User, AccreditationTier } from './entities/user.entity';
import { AccreditationReview } from './entities/accreditation-review.entity';
import { AnnualInvestmentCap } from './entities/annual-investment-cap.entity';

@Injectable()
export class AccreditationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AnnualInvestmentCap)
    private readonly capRepo: Repository<AnnualInvestmentCap>,
    @InjectRepository(AccreditationReview)
    private readonly reviewRepo: Repository<AccreditationReview>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AccreditationService.name);
  }

  /**
   * Investor submits a self-declaration requesting an upgraded accreditation tier.
   * Creates a review queue entry with status='pending'.
   */
  async submitDeclaration(
    userId: string,
    tier: 'accredited' | 'institutional',
    documentUrl?: string,
  ): Promise<AccreditationReview> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Mark user status as pending
    await this.userRepo.update(userId, { accreditationStatus: 'pending' });

    const review = this.reviewRepo.create({
      userId,
      tierRequested: tier,
      documentUrl: documentUrl ?? null,
      status: 'pending',
    });

    const saved = await this.reviewRepo.save(review);
    this.logger.info({ userId, tier }, 'Accreditation declaration submitted');
    return saved;
  }

  /**
   * Admin approves an accreditation request.
   * Sets accreditationStatus='approved', updates tier, sets expiry to now + 2 years.
   */
  async approveAccreditation(userId: string, reviewedBy: string): Promise<User> {
    const review = await this.reviewRepo.findOne({
      where: { userId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });

    if (!review) {
      throw new NotFoundException('No pending accreditation review found for this user');
    }

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2);

    // Update the review record
    await this.reviewRepo.update(review.id, {
      status: 'approved',
      reviewedBy,
      reviewedAt: new Date(),
    });

    // Update the user
    await this.userRepo.update(userId, {
      accreditationStatus: 'approved',
      accreditationTier: review.tierRequested as AccreditationTier,
      accreditationExpiresAt: expiresAt,
    });

    const updated = await this.userRepo.findOne({ where: { id: userId } });
    this.logger.info({ userId, tier: review.tierRequested }, 'Accreditation approved');
    return updated!;
  }

  /**
   * Admin rejects an accreditation request.
   * Resets accreditationStatus to 'none'.
   */
  async rejectAccreditation(userId: string, reviewedBy: string): Promise<User> {
    const review = await this.reviewRepo.findOne({
      where: { userId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });

    if (!review) {
      throw new NotFoundException('No pending accreditation review found for this user');
    }

    await this.reviewRepo.update(review.id, {
      status: 'rejected',
      reviewedBy,
      reviewedAt: new Date(),
    });

    await this.userRepo.update(userId, {
      accreditationStatus: 'none',
    });

    const updated = await this.userRepo.findOne({ where: { id: userId } });
    this.logger.info({ userId }, 'Accreditation rejected');
    return updated!;
  }

  /**
   * Runs daily at midnight. Finds users whose accreditation has expired
   * and resets them back to retail/expired status.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkAccreditationExpiry(): Promise<void> {
    this.logger.info('Running cron: checkAccreditationExpiry');
    const now = new Date();

    const expiredUsers = await this.userRepo.find({
      where: {
        accreditationStatus: 'approved',
        accreditationExpiresAt: LessThan(now),
      },
    });

    if (expiredUsers.length === 0) {
      return;
    }

    for (const user of expiredUsers) {
      await this.userRepo.update(user.id, {
        accreditationStatus: 'expired',
        accreditationTier: 'retail',
      });
    }

    this.logger.info(
      { count: expiredUsers.length },
      'Accreditation expiry check completed',
    );
  }

  /**
   * Returns all pending accreditation reviews.
   */
  async getPendingReviews(): Promise<AccreditationReview[]> {
    return this.reviewRepo.find({
      where: { status: 'pending' },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Returns the effective accreditation tier for a user.
   * If status is expired, returns 'retail' regardless of stored tier.
   */
  getUserTier(user: User): AccreditationTier {
    if (user.accreditationStatus === 'expired') {
      return 'retail';
    }
    return user.accreditationTier;
  }
}
