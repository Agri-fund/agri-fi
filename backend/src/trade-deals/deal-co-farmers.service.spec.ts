import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DealCoFarmersService } from './deal-co-farmers.service';
import { DealCoFarmer } from './entities/deal-co-farmer.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { QueueService } from '../queue/queue.service';

const buildDeal = (overrides: Partial<TradeDeal> = {}): TradeDeal =>
  ({
    id: 'deal-1',
    commodity: 'Cocoa',
    status: 'draft',
    farmerId: 'lead-farmer',
    traderId: 'trader-1',
    ...overrides,
  }) as unknown as TradeDeal;

const buildUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'co-farmer-1',
    email: 'co@example.com',
    fullName: 'Co Farmer',
    role: 'farmer',
    kycStatus: 'verified',
    walletAddress: 'GCOFARMER',
    ...overrides,
  }) as unknown as User;

describe('DealCoFarmersService (#891)', () => {
  let service: DealCoFarmersService;
  let coFarmerRepo: Record<string, jest.Mock>;
  let tradeDealRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let queueService: Record<string, jest.Mock>;

  const baseRecord = (): DealCoFarmer =>
    ({
      id: 'cf-row-1',
      tradeDealId: 'deal-1',
      farmerId: 'co-farmer-1',
      portionPercent: 25,
      status: 'invited',
      invitedEmail: 'co@example.com',
      invitationToken: 'tok-123',
      invitationExpiresAt: new Date(Date.now() + 86_400_000),
      invitedBy: 'lead-farmer',
    }) as unknown as DealCoFarmer;

  beforeEach(async () => {
    coFarmerRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity, data) => data ?? _entity),
      save: jest.fn(async (r: any) => r),
    };
    tradeDealRepo = { findOne: jest.fn() };
    userRepo = { findOne: jest.fn() };
    queueService = { emit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealCoFarmersService,
        { provide: getRepositoryToken(DealCoFarmer), useValue: coFarmerRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: QueueService, useValue: queueService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DealCoFarmersService>(DealCoFarmersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('inviteCoFarmer', () => {
    const dto = { email: 'co@example.com', portionPercent: 25 };

    beforeEach(() => {
      tradeDealRepo.findOne.mockResolvedValue(buildDeal());
      userRepo.findOne.mockResolvedValue(buildUser());
    });

    it('creates an invitation and enqueues a localized email', async () => {
      const record = await service.inviteCoFarmer('deal-1', 'lead-farmer', dto);

      expect(record.status).toBe('invited');
      expect(record.portionPercent).toBe(25);
      expect(record.invitationToken).toEqual(expect.any(String));
      expect(record.invitationToken).toHaveLength(64);
      expect(coFarmerRepo.save).toHaveBeenCalledTimes(1);

      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({
          type: 'co_farmer_invitation',
          userId: 'co-farmer-1',
          acceptUrl: expect.stringContaining('/co-farmers/accept?token='),
        }),
      );
    });

    it('rejects when neither email nor walletAddress is provided', async () => {
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', { portionPercent: 10 }),
      ).rejects.toThrow(BadRequestException);
      expect(coFarmerRepo.save).not.toHaveBeenCalled();
    });

    it('forbids users who are neither lead farmer nor trader', async () => {
      await expect(
        service.inviteCoFarmer('deal-1', 'random-user', dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows either the lead farmer or the assigned trader to invite', async () => {
      const viaTrader = await service.inviteCoFarmer('deal-1', 'trader-1', dto);
      expect(viaTrader.status).toBe('invited');
    });

    it('rejects invitations once the deal is past draft/open', async () => {
      tradeDealRepo.findOne.mockResolvedValue(buildDeal({ status: 'funded' }));
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects targets that are missing or not farmers', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto),
      ).rejects.toThrow(BadRequestException);

      userRepo.findOne.mockResolvedValue(buildUser({ role: 'investor' }));
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects inviting the lead farmer as their own co-farmer', async () => {
      userRepo.findOne.mockResolvedValue(buildUser({ id: 'lead-farmer' }));
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects duplicate active invitations for the same user', async () => {
      coFarmerRepo.findOne.mockResolvedValue(baseRecord());
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects portions pushing the committed total over 100%', async () => {
      coFarmerRepo.find.mockResolvedValue([
        { farmerId: 'x', portionPercent: 60, status: 'accepted' },
        { farmerId: 'y', portionPercent: 30, status: 'invited' },
      ]);
      await expect(
        service.inviteCoFarmer('deal-1', 'lead-farmer', dto), // +25 → 115
      ).rejects.toThrow(BadRequestException);
    });

    it('ignores removed rows when summing committed portions and re-invites them', async () => {
      coFarmerRepo.find.mockResolvedValue([
        { farmerId: 'co-farmer-1', portionPercent: 90, status: 'removed' },
        { farmerId: 'z', portionPercent: 40, status: 'accepted' },
      ]);
      coFarmerRepo.findOne.mockResolvedValue({
        ...baseRecord(),
        status: 'removed',
      });

      const record = await service.inviteCoFarmer('deal-1', 'lead-farmer', dto);
      // Removed row excluded → 40 + 25 = 65 ≤ 100; existing row re-invited
      expect(record.status).toBe('invited');
      expect(coFarmerRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvitation', () => {
    it('marks the invitation accepted and clears the token', async () => {
      coFarmerRepo.findOne.mockResolvedValue(baseRecord());

      const record = await service.acceptInvitation(
        'deal-1',
        'co-farmer-1',
        'tok-123',
      );

      expect(record.status).toBe('accepted');
      expect(record.acceptedAt).toBeInstanceOf(Date);
      expect(record.invitationToken).toBeNull();
    });

    it('rejects an expired token', async () => {
      coFarmerRepo.findOne.mockResolvedValue({
        ...baseRecord(),
        invitationExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.acceptInvitation('deal-1', 'co-farmer-1', 'tok-123'),
      ).rejects.toThrow(/expired/i);
    });

    it('rejects a mismatched token', async () => {
      coFarmerRepo.findOne.mockResolvedValue(baseRecord());
      await expect(
        service.acceptInvitation('deal-1', 'co-farmer-1', 'wrong'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects accepting twice', async () => {
      coFarmerRepo.findOne.mockResolvedValue({
        ...baseRecord(),
        status: 'accepted',
      });
      await expect(
        service.acceptInvitation('deal-1', 'co-farmer-1', 'tok-123'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('declineInvitation', () => {
    it('marks the invitation declined', async () => {
      coFarmerRepo.findOne.mockResolvedValue(baseRecord());

      const record = await service.declineInvitation(
        'deal-1',
        'co-farmer-1',
        'tok-123',
      );

      expect(record.status).toBe('declined');
      expect(record.declinedAt).toBeInstanceOf(Date);
    });
  });

  describe('removeCoFarmer', () => {
    beforeEach(() => tradeDealRepo.findOne.mockResolvedValue(buildDeal()));

    it('soft-removes the co-farmer row when requested by the owner', async () => {
      coFarmerRepo.findOne.mockResolvedValue(baseRecord());

      await service.removeCoFarmer('deal-1', 'co-farmer-1', 'trader-1');

      expect(coFarmerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'removed' }),
      );
    });

    it('forbids removal by unrelated users', async () => {
      await expect(
        service.removeCoFarmer('deal-1', 'co-farmer-1', 'someone-else'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks removal after delivery', async () => {
      tradeDealRepo.findOne.mockResolvedValue(
        buildDeal({ status: 'delivered' }),
      );
      await expect(
        service.removeCoFarmer('deal-1', 'co-farmer-1', 'lead-farmer'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('assertAllCoFarmersVerified (KYC gate)', () => {
    it('passes immediately when the deal has no co-farmers', async () => {
      coFarmerRepo.find.mockResolvedValue([]);
      await expect(
        service.assertAllCoFarmersVerified('deal-1'),
      ).resolves.toBeUndefined();
    });

    it('passes when every co-farmer accepted and is KYC verified', async () => {
      coFarmerRepo.find.mockResolvedValue([
        {
          farmerId: 'a',
          status: 'accepted',
          farmer: { kycStatus: 'verified' },
        },
        {
          farmerId: 'b',
          status: 'removed',
          farmer: { kycStatus: 'unverified' },
        },
      ]);
      await expect(
        service.assertAllCoFarmersVerified('deal-1'),
      ).resolves.toBeUndefined();
    });

    it('throws when an invitation is still pending', async () => {
      coFarmerRepo.find.mockResolvedValue([
        {
          farmerId: 'a',
          status: 'accepted',
          farmer: { kycStatus: 'verified' },
        },
        {
          farmerId: 'b',
          status: 'invited',
          farmer: { kycStatus: 'verified' },
        },
      ]);
      await expect(
        service.assertAllCoFarmersVerified('deal-1'),
      ).rejects.toMatchResponse({
        code: 'CO_FARMERS_NOT_VERIFIED',
        details: [{ farmerId: 'b', reason: 'invitation_not_accepted' }],
      });
    });

    it('throws when a co-farmer has not passed KYC', async () => {
      coFarmerRepo.find.mockResolvedValue([
        {
          farmerId: 'a',
          status: 'accepted',
          farmer: { kycStatus: 'pending' },
        },
      ]);
      await expect(
        service.assertAllCoFarmersVerified('deal-1'),
      ).rejects.toMatchResponse({
        code: 'CO_FARMERS_NOT_VERIFIED',
        details: [{ farmerId: 'a', reason: 'kyc_pending' }],
      });
    });
  });
});

/** Matches the JSON body of an HttpException (available as .getResponse()). */
expect.extend({
  toMatchResponse(received: Error, expected: Record<string, unknown>) {
    const response = (received as any).getResponse?.();
    let pass = true;
    try {
      expect(response).toMatchObject(expected);
    } catch {
      pass = false;
    }
    return {
      pass,
      message: () =>
        `expected exception response ${JSON.stringify(response)} to match ${JSON.stringify(expected)}`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toMatchResponse(expected: Record<string, unknown>): R;
    }
  }
}
