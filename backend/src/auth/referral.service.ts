import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReferralCode } from './entities/referral-code.entity';
import { Referral } from './entities/referral.entity';
import { User } from './entities/user.entity';

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(ReferralCode)
    private readonly referralCodeRepo: Repository<ReferralCode>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getOrCreateCode(userId: string): Promise<ReferralCode> {
    let code = await this.referralCodeRepo.findOne({ where: { userId } });
    if (code) return code;

    // Generate unique code with collision retry
    let newCode: string;
    let attempts = 0;
    do {
      newCode = generateCode();
      attempts++;
      if (attempts > 10) throw new Error('Failed to generate unique referral code');
    } while (await this.referralCodeRepo.findOne({ where: { code: newCode } }));

    code = this.referralCodeRepo.create({ userId, code: newCode });
    return this.referralCodeRepo.save(code);
  }

  async trackClick(code: string): Promise<{ referralId: string }> {
    const referralCode = await this.referralCodeRepo.findOne({ where: { code } });
    if (!referralCode) throw new NotFoundException('Invalid referral code');

    const referral = this.referralRepo.create({
      referrerId: referralCode.userId,
      status: 'clicked',
    });
    const saved = await this.referralRepo.save(referral);
    return { referralId: saved.id };
  }

  async trackRegistration(refereeId: string, code: string): Promise<void> {
    const referralCode = await this.referralCodeRepo.findOne({ where: { code } });
    if (!referralCode) return;

    const referral = this.referralRepo.create({
      referrerId: referralCode.userId,
      refereeId,
      status: 'registered',
    });
    await this.referralRepo.save(referral);
  }

  async triggerReward(refereeId: string): Promise<void> {
    const referral = await this.referralRepo.findOne({
      where: { refereeId, status: 'registered' },
    });
    if (!referral) return;

    referral.status = 'rewarded';
    referral.rewardAmount = 5.0; // $5 USDC credit
    await this.referralRepo.save(referral);
  }

  async getReferralStats(userId: string): Promise<{
    code: string;
    totalClicks: number;
    totalRegistered: number;
    totalRewarded: number;
    totalRewardAmount: number;
    referrals: Referral[];
  }> {
    const code = await this.referralCodeRepo.findOne({ where: { userId } });
    if (!code) {
      // Lazy generate
      const newCode = await this.getOrCreateCode(userId);
      return {
        code: newCode.code,
        totalClicks: 0,
        totalRegistered: 0,
        totalRewarded: 0,
        totalRewardAmount: 0,
        referrals: [],
      };
    }

    const referrals = await this.referralRepo.find({
      where: { referrerId: userId },
      order: { createdAt: 'DESC' },
      relations: ['referee'],
    });

    return {
      code: code.code,
      totalClicks: referrals.filter((r) => r.status === 'clicked').length,
      totalRegistered: referrals.filter((r) => r.status === 'registered').length,
      totalRewarded: referrals.filter((r) => r.status === 'rewarded').length,
      totalRewardAmount: referrals.reduce((sum, r) => sum + Number(r.rewardAmount), 0),
      referrals,
    };
  }
}
