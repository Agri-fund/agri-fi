jest.mock('../auth/entities/user.entity', () => ({
  User: class MockUser {},
}));

import { KycService } from './kyc.service';

describe('KycService.checkEddTriggers', () => {
  let service: KycService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock; find: jest.Mock };
  let investmentRepo: { find: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };
  const user = () =>
    ({
      id: 'user-1',
      email: 'investor@example.com',
      country: 'KE',
      kycStatus: 'verified',
      kycEddReason: null,
      kycEddTriggeredAt: null,
    }) as any;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue(user()),
      save: jest.fn((value) => Promise.resolve(value)),
      find: jest.fn(),
    };
    investmentRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new KycService(
      userRepo as any,
      investmentRepo as any,
      notificationsService as any,
      { setContext: jest.fn(), error: jest.fn() } as any,
    );
  });

  it('requires EDD for a single transaction over $50,000 and emails the user', async () => {
    const result = await service.checkEddTriggers('user-1', 50_001);

    expect(result).toMatchObject({
      triggered: true,
      reasons: ['Single transaction exceeds $50,000'],
    });
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ kycStatus: 'EDD_REQUIRED' }),
    );
    expect(notificationsService.sendEmail).toHaveBeenCalledWith(
      'investor@example.com',
      expect.any(String),
      expect.stringContaining('$50,000'),
      expect.any(String),
    );
  });

  it('requires EDD when 30-day volume exceeds $100,000', async () => {
    investmentRepo.find.mockResolvedValue([
      { amountUsd: 60_000, createdAt: new Date(), status: 'confirmed' },
      { amountUsd: 40_001, createdAt: new Date(), status: 'pending' },
    ]);

    const result = await service.checkEddTriggers('user-1', 1);

    expect(result.reasons).toContain(
      '30-day transaction volume exceeds $100,000',
    );
    expect(userRepo.save).toHaveBeenCalled();
  });

  it('requires EDD when activity spans at least three countries in 30 days', async () => {
    investmentRepo.find.mockResolvedValue([
      {
        amountUsd: 100,
        createdAt: new Date(),
        status: 'confirmed',
        tradeDeal: { farmer: { country: 'UG' } },
      },
      {
        amountUsd: 100,
        createdAt: new Date(),
        status: 'confirmed',
        tradeDeal: { farmer: { country: 'TZ' } },
      },
    ]);

    const result = await service.checkEddTriggers('user-1', 1);

    expect(result.reasons).toContain(
      'Transactions involve 3 or more countries in 30 days',
    );
  });

  it('returns EDD reviews as high priority for the admin queue', async () => {
    const triggeredAt = new Date();
    userRepo.find.mockResolvedValue([
      {
        id: 'user-1',
        email: 'investor@example.com',
        country: 'KE',
        kycEddReason: 'Single transaction exceeds $50,000',
        kycEddTriggeredAt: triggeredAt,
      },
    ]);

    await expect(service.listEddQueue()).resolves.toEqual([
      {
        userId: 'user-1',
        email: 'investor@example.com',
        country: 'KE',
        reason: 'Single transaction exceeds $50,000',
        triggeredAt,
        priority: 'high',
      },
    ]);
  });
});
