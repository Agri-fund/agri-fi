import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement, BadgeType } from './entities/achievement.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';

export interface AchievementEvent {
  type: 'investment_confirmed' | 'referral_completed' | 'deal_matured';
  userId: string;
  tradeDealId?: string;
  investmentId?: string;
  investmentDate?: Date;
  dealOpenDate?: Date;
  isFirstTimeFarmer?: boolean;
}

@Injectable()
export class AchievementService {
  constructor(
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getUserAchievements(userId: string): Promise<Achievement[]> {
    return this.achievementRepo.find({
      where: { userId },
      order: { earnedAt: 'DESC' },
    });
  }

  async checkAndAward(
    userId: string,
    event: AchievementEvent,
  ): Promise<Achievement[]> {
    const newlyAwarded: Achievement[] = [];

    if (event.type === 'investment_confirmed') {
      const confirmedCount = await this.investmentRepo.count({
        where: { investorId: userId, status: InvestmentStatus.CONFIRMED },
      });

      // 1. First Investment
      if (confirmedCount >= 1) {
        const badge = await this.awardBadge(userId, 'first_investment', {
          event: 'first_investment',
        });
        if (badge) newlyAwarded.push(badge);
      }

      // 2. Diversified (5 different deals)
      const uniqueDeals = await this.investmentRepo
        .createQueryBuilder('inv')
        .select('DISTINCT inv.tradeDealId')
        .where('inv.investorId = :userId', { userId })
        .andWhere('inv.status = :status', {
          status: InvestmentStatus.CONFIRMED,
        })
        .getRawMany();

      if (uniqueDeals.length >= 5) {
        const badge = await this.awardBadge(userId, 'diversified', {
          dealCount: uniqueDeals.length,
        });
        if (badge) newlyAwarded.push(badge);
      }

      // 3. Early Bird (invest within 24h of deal opening)
      if (event.tradeDealId && event.investmentDate && event.dealOpenDate) {
        const diffMs =
          event.investmentDate.getTime() - event.dealOpenDate.getTime();
        const hours = diffMs / (1000 * 60 * 60);
        if (hours <= 24) {
          const badge = await this.awardBadge(userId, 'early_bird', {
            hoursAfterOpen: hours,
            tradeDealId: event.tradeDealId,
          });
          if (badge) newlyAwarded.push(badge);
        }
      }

      // 5. Impact Farmer (first-time farmer deal)
      if (event.isFirstTimeFarmer) {
        const badge = await this.awardBadge(userId, 'impact_farmer', {
          tradeDealId: event.tradeDealId,
        });
        if (badge) newlyAwarded.push(badge);
      }
    }

    // 4. Long-term (hold investment to full maturity)
    if (event.type === 'deal_matured') {
      const badge = await this.awardBadge(userId, 'long_term', {
        tradeDealId: event.tradeDealId,
      });
      if (badge) newlyAwarded.push(badge);
    }

    // 6. Community (refer 3 investors who complete first investment)
    if (event.type === 'referral_completed') {
      const user: any = await this.userRepo.findOne({ where: { id: userId } });
      if (user && (user.referralCount ?? 0) >= 3) {
        const badge = await this.awardBadge(userId, 'community', {
          referralCount: user.referralCount,
        });
        if (badge) newlyAwarded.push(badge);
      }
    }

    return newlyAwarded;
  }

  async awardBadge(
    userId: string,
    badgeType: BadgeType,
    metadata?: Record<string, unknown>,
    grantedBy = 'system',
    reason?: string,
  ): Promise<Achievement | null> {
    const existing = await this.achievementRepo.findOne({
      where: { userId, badgeType },
    });
    if (existing) {
      return null; // Idempotent: badge already earned
    }

    const achievement = this.achievementRepo.create({
      userId,
      badgeType,
      earnedAt: new Date(),
      grantedBy,
      reason: reason ?? null,
      metadata: metadata ?? null,
    });

    try {
      return await this.achievementRepo.save(achievement);
    } catch (err: any) {
      if (err.code === '23505') {
        // Unique constraint violation - idempotent fallback
        return null;
      }
      throw err;
    }
  }

  async adminGrantBadge(
    userId: string,
    badgeType: BadgeType,
    grantedBy: string,
    reason: string,
  ): Promise<Achievement> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        'A valid reason is required for admin badge granting.',
      );
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const badge = await this.awardBadge(
      userId,
      badgeType,
      { adminAction: true },
      grantedBy,
      reason,
    );
    if (!badge) {
      throw new ConflictException('User already possesses this badge.');
    }
    return badge;
  }

  async adminRevokeBadge(
    userId: string,
    badgeType: BadgeType,
    reason: string,
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        'A valid reason is required for admin badge revocation.',
      );
    }
    const badge = await this.achievementRepo.findOne({
      where: { userId, badgeType },
    });
    if (!badge) {
      throw new NotFoundException('Achievement badge not found for this user.');
    }

    await this.achievementRepo.remove(badge);
  }
}
