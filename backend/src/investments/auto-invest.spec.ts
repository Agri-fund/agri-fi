import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { AutoInvestService } from './auto-invest.service';
import { AutoInvestPlan } from './entities/auto-invest-plan.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { RiskScoringService } from '../trade-deals/risk-scoring.service';
import { User } from '../auth/entities/user.entity';
import { CreateAutoInvestPlanDto } from './dto/auto-invest-plan.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { PinoLogger } from 'nestjs-pino';

const INVESTOR_ID = 'investor-uuid-1234';

function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: INVESTOR_ID,
    kycStatus: 'verified',
    role: 'investor',
    ...overrides,
  } as unknown as User;
}

function mockPlan(overrides: Partial<AutoInvestPlan> = {}): AutoInvestPlan {
  return {
    id: 'plan-uuid-5678',
    investorId: INVESTOR_ID,
    name: 'Test strategy',
    amountUsd: 500 as any,
    cadence: 'monthly',
    fundingWallet: 'GTEST123',
    maxRiskScore: 75 as any,
    dealTypeFilter: null,
    minimumExpectedRoi: null,
    regionFilter: null,
    maxDurationDays: null,
    maxPositionUsd: null,
    isPublic: false,
    version: 1,
    versionHistory: [],
    status: 'active',
    dailyCapUsd: null,
    consecutiveFailures: 0,
    nextRunAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as AutoInvestPlan;
}

function makeRepos() {
  const planRepo = {
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockImplementation(async (entity) => ({ id: 'plan-uuid-new', ...entity })),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };

  const dealRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const userRepo = {
    findOne: jest.fn().mockResolvedValue(mockUser()),
  };

  return { planRepo, dealRepo, userRepo };
}

function makeServices() {
  return {
    riskScoringService: { computeScore: jest.fn().mockResolvedValue({ score: 30, rating: 'Low', breakdown: {} }) },
    notificationsService: { createNotification: jest.fn().mockResolvedValue({}) },
    queueService: { enqueueInvestmentFund: jest.fn().mockResolvedValue(undefined) },
    logger: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    dataSource: {},
  };
}

describe('AutoInvestService — plan CRUD (#1001)', () => {
  let service: AutoInvestService;
  let planRepo: ReturnType<typeof makeRepos>['planRepo'];
  let userRepo: ReturnType<typeof makeRepos>['userRepo'];

  beforeEach(async () => {
    const repos = makeRepos();
    planRepo = repos.planRepo;
    userRepo = repos.userRepo;
    const svcs = makeServices();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoInvestService,
        { provide: getRepositoryToken(AutoInvestPlan), useValue: planRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: repos.dealRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RiskScoringService, useValue: svcs.riskScoringService },
        { provide: NotificationsService, useValue: svcs.notificationsService },
        { provide: QueueService, useValue: svcs.queueService },
        { provide: PinoLogger, useValue: svcs.logger },
        { provide: DataSource, useValue: svcs.dataSource },
      ],
    }).compile();

    service = module.get(AutoInvestService);
  });

  describe('createPlan', () => {
    it('creates an active plan with a future nextRunAt', async () => {
      const dto: CreateAutoInvestPlanDto = {
        amountUsd: 500,
        cadence: 'monthly',
        fundingWallet: 'GTEST123',
        maxRiskScore: 75,
      };

      const saved = await service.createPlan(INVESTOR_ID, dto);

      expect(planRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          investorId: INVESTOR_ID,
          amountUsd: 500,
          cadence: 'monthly',
          status: 'active',
          consecutiveFailures: 0,
        }),
      );
      expect(new Date(saved.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('throws ForbiddenException when user is not investor', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ role: 'farmer' }));
      await expect(
        service.createPlan(INVESTOR_ID, { amountUsd: 100, cadence: 'weekly', fundingWallet: 'G123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when KYC is pending', async () => {
      userRepo.findOne.mockResolvedValue(mockUser({ kycStatus: 'pending' }));
      await expect(
        service.createPlan(INVESTOR_ID, { amountUsd: 100, cadence: 'weekly', fundingWallet: 'G123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createPlan(INVESTOR_ID, { amountUsd: 100, cadence: 'weekly', fundingWallet: 'G123' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns plan owned by investor', async () => {
      const plan = mockPlan();
      planRepo.findOne.mockResolvedValue(plan);
      const result = await service.findOne(plan.id, INVESTOR_ID);
      expect(result).toBe(plan);
    });

    it('throws NotFoundException when plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent', INVESTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for wrong investor', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan({ investorId: 'other-investor' }));
      await expect(service.findOne('plan-uuid', INVESTOR_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('strategy versioning', () => {
    it('stores the previous criteria snapshot when a strategy is edited', async () => {
      const plan = mockPlan();
      planRepo.findOne.mockResolvedValue(plan);
      planRepo.save.mockImplementation(async (saved: any) => saved);

      const updated = await service.updatePlan(plan.id, INVESTOR_ID, {
        minimumExpectedRoi: 15,
      });

      expect(updated.version).toBe(2);
      expect(updated.versionHistory).toEqual([
        expect.objectContaining({
          version: 1,
          snapshot: expect.objectContaining({ minimumExpectedRoi: null }),
        }),
      ]);
      expect(updated.minimumExpectedRoi).toBe(15);
    });
  });

  describe('pausePlan', () => {
    it('sets status to paused', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan());
      planRepo.save.mockImplementation(async (p: any) => p);
      const result = await service.pausePlan('plan-uuid', INVESTOR_ID, true);
      expect(result.status).toBe('paused');
    });

    it('resets consecutiveFailures on resume', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan({ status: 'paused', consecutiveFailures: 2 }));
      planRepo.save.mockImplementation(async (p: any) => p);
      const result = await service.pausePlan('plan-uuid', INVESTOR_ID, false);
      expect(result.status).toBe('active');
      expect(result.consecutiveFailures).toBe(0);
    });

    it('throws ConflictException on cancelled plan', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan({ status: 'cancelled' }));
      await expect(service.pausePlan('plan-uuid', INVESTOR_ID, true)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cancelPlan', () => {
    it('sets status to cancelled and soft-deletes', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan());
      planRepo.save.mockImplementation(async (p: any) => p);
      const result = await service.cancelPlan('plan-uuid', INVESTOR_ID);
      expect(result.status).toBe('cancelled');
      expect(planRepo.softDelete).toHaveBeenCalledWith('plan-uuid');
    });
  });
});

describe('AutoInvestService — allocation pipeline (#1001)', () => {
  let service: AutoInvestService;
  let planRepo: ReturnType<typeof makeRepos>['planRepo'];
  let dealRepo: ReturnType<typeof makeRepos>['dealRepo'];
  let queueService: { enqueueInvestmentFund: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let riskScoringService: { computeScore: jest.Mock };

  beforeEach(async () => {
    const repos = makeRepos();
    planRepo = repos.planRepo;
    dealRepo = repos.dealRepo;
    const svcs = makeServices();
    queueService = svcs.queueService;
    notificationsService = svcs.notificationsService;
    riskScoringService = svcs.riskScoringService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoInvestService,
        { provide: getRepositoryToken(AutoInvestPlan), useValue: planRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepo },
        { provide: getRepositoryToken(User), useValue: repos.userRepo },
        { provide: RiskScoringService, useValue: riskScoringService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: QueueService, useValue: queueService },
        { provide: PinoLogger, useValue: svcs.logger },
        { provide: DataSource, useValue: svcs.dataSource },
      ],
    }).compile();

    service = module.get(AutoInvestService);
  });

  it('alerts about an eligible deal without submitting an unsigned transaction', async () => {
    const plan = mockPlan({
      nextRunAt: new Date(Date.now() - 1000),
      maxPositionUsd: 300 as any,
      dailyCapUsd: 200 as any,
    });
    planRepo.find.mockResolvedValue([plan]);
    planRepo.save.mockImplementation(async (p: any) => p);

    dealRepo.find.mockResolvedValue([
      {
        id: 'deal-001',
        status: 'open',
        commodity: 'cocoa',
        riskScore: 30,
        totalValue: 10000,
        totalInvested: 2000,
        escrowPublicKey: 'GESCROW',
        escrowSecretKey: 'encrypted-key',
        tokenSymbol: 'COCOA001',
      },
    ]);

    await service.runAllocationCycle();

    expect(queueService.enqueueInvestmentFund).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Auto-Invest: Deal Matched',
        metadataJson: expect.objectContaining({
          event: 'matched_awaiting_signature',
          dealId: 'deal-001',
          tokenAmount: 2,
          amountUsd: 200,
        }),
      }),
    );
  });

  it('skips deals above maxRiskScore', async () => {
    const plan = mockPlan({ nextRunAt: new Date(Date.now() - 1000), maxRiskScore: 40 as any });
    planRepo.find.mockResolvedValue([plan]);
    planRepo.save.mockImplementation(async (p: any) => p);

    dealRepo.find.mockResolvedValue([
      {
        id: 'deal-002',
        status: 'open',
        commodity: 'cocoa',
        riskScore: 60, // above maxRiskScore of 40
        totalValue: 10000,
        totalInvested: 1000,
        escrowPublicKey: 'GESCROW',
        escrowSecretKey: null,
        tokenSymbol: 'COCOA002',
      },
    ]);

    await service.runAllocationCycle();

    expect(queueService.enqueueInvestmentFund).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Auto-Invest: No Eligible Deals' }),
    );
  });

  it('filters deals by dealTypeFilter commodity whitelist', async () => {
    const plan = mockPlan({
      nextRunAt: new Date(Date.now() - 1000),
      dealTypeFilter: ['wheat'],
    });
    planRepo.find.mockResolvedValue([plan]);
    planRepo.save.mockImplementation(async (p: any) => p);

    dealRepo.find.mockResolvedValue([
      {
        id: 'deal-003',
        status: 'open',
        commodity: 'cocoa', // not in whitelist
        riskScore: 20,
        totalValue: 10000,
        totalInvested: 500,
        escrowPublicKey: 'GESCROW',
        escrowSecretKey: null,
        tokenSymbol: 'COCOA003',
      },
    ]);

    await service.runAllocationCycle();

    expect(queueService.enqueueInvestmentFund).not.toHaveBeenCalled();
  });

  it('does not count a signature-required match as an execution failure', async () => {
    const plan = mockPlan({
      nextRunAt: new Date(Date.now() - 1000),
      consecutiveFailures: 2,
    });
    planRepo.find.mockResolvedValue([plan]);
    planRepo.save.mockImplementation(async (p: any) => p);

    dealRepo.find.mockResolvedValue([
      {
        id: 'deal-004',
        status: 'open',
        commodity: 'cocoa',
        riskScore: 20,
        totalValue: 10000,
        totalInvested: 500,
        escrowPublicKey: 'GESCROW',
        escrowSecretKey: null,
        tokenSymbol: 'COCOA004',
      },
    ]);

    await service.runAllocationCycle();

    const savedPlan = planRepo.save.mock.calls[planRepo.save.mock.calls.length - 1][0];
    expect(savedPlan.status).toBe('active');
    expect(savedPlan.consecutiveFailures).toBe(2);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Auto-Invest: Deal Matched' }),
    );
  });

  it('does nothing when no plans are due', async () => {
    planRepo.find.mockResolvedValue([]);
    await service.runAllocationCycle();
    expect(queueService.enqueueInvestmentFund).not.toHaveBeenCalled();
  });

  it('backtests criteria against historical deals and labels ROI as estimated', async () => {
    const plan = mockPlan({ minimumExpectedRoi: 12 as any, regionFilter: ['Africa'] });
    planRepo.findOne.mockResolvedValue(plan);
    dealRepo.find.mockResolvedValue([
      {
        id: 'historical-africa-deal',
        commodity: 'cocoa',
        farmLocation: 'Ghana, Africa',
        expectedRoi: 20,
        durationDays: 120,
        riskScore: 30,
      },
      {
        id: 'historical-low-roi-deal',
        commodity: 'coffee',
        farmLocation: 'Ghana, Africa',
        expectedRoi: 8,
        durationDays: 120,
        riskScore: 30,
      },
    ] as TradeDeal[]);

    const result = await service.backtestPlan(
      'plan-uuid-5678',
      INVESTOR_ID,
      '2025-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );

    expect(result.matchedDeals).toBe(1);
    expect(result.averageExpectedRoiPct).toBe(20);
    expect(result.realizedReturnsAvailable).toBe(false);
  });

  it('sends notification when no open deals exist', async () => {
    const plan = mockPlan({ nextRunAt: new Date(Date.now() - 1000) });
    planRepo.find.mockResolvedValue([plan]);
    planRepo.save.mockImplementation(async (p: any) => p);
    dealRepo.find.mockResolvedValue([]);

    await service.runAllocationCycle();

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Auto-Invest: No Open Deals' }),
    );
    expect(queueService.enqueueInvestmentFund).not.toHaveBeenCalled();
  });
});
