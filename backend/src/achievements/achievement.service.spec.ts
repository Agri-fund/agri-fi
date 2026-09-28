import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AchievementService } from './achievement.service';
import { Achievement } from './entities/achievement.entity';
import { Investment } from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { BadRequestException } from '@nestjs/common';

describe('AchievementService', () => {
  let service: AchievementService;
  let achievementRepo: any;
  let investmentRepo: any;
  let tradeDealRepo: any;
  let userRepo: any;

  beforeEach(async () => {
    achievementRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((val) => val),
      save: jest.fn((val) => Promise.resolve({ id: 'badge-1', ...val })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    investmentRepo = {
      count: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    tradeDealRepo = { findOne: jest.fn() };
    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementService,
        { provide: getRepositoryToken(Achievement), useValue: achievementRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<AchievementService>(AchievementService);
  });

  describe('checkAndAward - First Investment', () => {
    it('awards first_investment badge on first confirmed investment', async () => {
      investmentRepo.count.mockResolvedValue(1);
      achievementRepo.findOne.mockResolvedValue(null);

      const awarded = await service.checkAndAward('user-1', {
        type: 'investment_confirmed',
        userId: 'user-1',
      });

      expect(awarded.length).toBe(1);
      expect(awarded[0].badgeType).toBe('first_investment');
    });

    it('is idempotent and does not award badge twice', async () => {
      investmentRepo.count.mockResolvedValue(2);
      achievementRepo.findOne.mockResolvedValue({ id: 'existing' });

      const awarded = await service.checkAndAward('user-1', {
        type: 'investment_confirmed',
        userId: 'user-1',
      });

      expect(awarded.length).toBe(0);
    });
  });

  describe('adminGrantBadge', () => {
    it('grants badge with reason', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1' });
      achievementRepo.findOne.mockResolvedValue(null);

      const badge = await service.adminGrantBadge(
        'user-1',
        'early_bird',
        'admin-1',
        'Good investor',
      );

      expect(badge.badgeType).toBe('early_bird');
      expect(badge.reason).toBe('Good investor');
    });

    it('throws BadRequestException if reason is missing', async () => {
      await expect(
        service.adminGrantBadge('user-1', 'early_bird', 'admin-1', ''),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
