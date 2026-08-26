import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Gauge } from 'prom-client';
import { DealHealthMonitorService } from './deal-health-monitor.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { DealHealthAlert } from './entities/deal-health-alert.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

function buildDeal(overrides: Partial<TradeDeal> = {}): TradeDeal {
  const now = new Date();
  const deliveryDate = new Date(now);
  deliveryDate.setDate(deliveryDate.getDate() + 5);

  return {
    id: 'deal-uuid-1',
    commodity: 'Cocoa',
    tokenSymbol: 'COC001',
    totalValue: 10_000,
    totalInvested: 0,
    status: 'open',
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    deliveryDate: deliveryDate.toISOString().split('T')[0],
    ...overrides,
  } as unknown as TradeDeal;
}

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  })),
});

const mockNotificationsService = () => ({
  createNotification: jest.fn(),
});

const mockAuditService = () => ({
  logEvent: jest.fn(),
});

const mockGauge = () => ({
  set: jest.fn(),
});

describe('DealHealthMonitorService', () => {
  let service: DealHealthMonitorService;
  let tradeDealRepo: ReturnType<typeof mockRepo>;
  let alertRepo: ReturnType<typeof mockRepo>;
  let investmentRepo: ReturnType<typeof mockRepo>;
  let milestoneRepo: ReturnType<typeof mockRepo>;
  let notificationsService: ReturnType<typeof mockNotificationsService>;
  let auditService: ReturnType<typeof mockAuditService>;
  let gauge: ReturnType<typeof mockGauge>;

  beforeEach(async () => {
    tradeDealRepo = mockRepo();
    alertRepo = mockRepo();
    investmentRepo = mockRepo();
    milestoneRepo = mockRepo();
    notificationsService = mockNotificationsService();
    auditService = mockAuditService();
    gauge = mockGauge();

    alertRepo.findOne.mockResolvedValue(null);
    alertRepo.create.mockImplementation((dto) => dto);
    alertRepo.save.mockImplementation(async (dto) => ({
      id: 'alert-uuid-1',
      ...dto,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealHealthMonitorService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(DealHealthAlert), useValue: alertRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
        { provide: AuditService, useValue: auditService },
        {
          provide: 'deal_health_alerts_active_total',
          useValue: gauge,
        },
      ],
    }).compile();

    service = module.get<DealHealthMonitorService>(DealHealthMonitorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('checkFundingBelowThreshold', () => {
    it('fires alert when funding is below 30% with <=7 days remaining', async () => {
      const now = new Date();
      const deliveryDate = new Date(now);
      deliveryDate.setDate(deliveryDate.getDate() + 5);

      const deal = buildDeal({
        totalInvested: 2_000,
        totalValue: 10_000,
        deliveryDate: deliveryDate.toISOString().split('T')[0],
      });

      await service.checkFundingBelowThreshold(deal);

      expect(alertRepo.create).toHaveBeenCalled();
      expect(alertRepo.save).toHaveBeenCalled();
      expect(notificationsService.createNotification).toHaveBeenCalled();
    });

    it('does not fire alert when funding is >= 30%', async () => {
      const deal = buildDeal({
        totalInvested: 3_000,
        totalValue: 10_000,
      });

      await service.checkFundingBelowThreshold(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });

    it('does not fire alert when days remaining > 7', async () => {
      const now = new Date();
      const deliveryDate = new Date(now);
      deliveryDate.setDate(deliveryDate.getDate() + 10);

      const deal = buildDeal({
        totalInvested: 1_000,
        totalValue: 10_000,
        deliveryDate: deliveryDate.toISOString().split('T')[0],
      });

      await service.checkFundingBelowThreshold(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });

    it('resolves alert when funding recovers above threshold', async () => {
      const existingAlert = {
        id: 'alert-1',
        dealId: 'deal-uuid-1',
        alertType: 'funding_below_threshold',
        resolvedAt: null,
      };
      alertRepo.findOne.mockResolvedValue(existingAlert);

      const deal = buildDeal({
        totalInvested: 5_000,
        totalValue: 10_000,
      });

      await service.checkFundingBelowThreshold(deal);

      expect(alertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ resolvedAt: expect.any(Date) }),
      );
    });
  });

  describe('checkNoRecentInvestment', () => {
    it('fires alert when no investment in last 48h', async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 50);

      investmentRepo.findOne.mockResolvedValue({
        createdAt: oldDate,
      });

      const deal = buildDeal();

      await service.checkNoRecentInvestment(deal);

      expect(alertRepo.create).toHaveBeenCalled();
      expect(alertRepo.save).toHaveBeenCalled();
    });

    it('does not fire alert when recent investment exists', async () => {
      investmentRepo.findOne.mockResolvedValue({
        createdAt: new Date(),
      });

      const deal = buildDeal();

      await service.checkNoRecentInvestment(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });

    it('fires alert when no investments exist at all', async () => {
      investmentRepo.findOne.mockResolvedValue(null);

      const deal = buildDeal();

      await service.checkNoRecentInvestment(deal);

      expect(alertRepo.create).toHaveBeenCalled();
    });
  });

  describe('checkShipmentOverdue', () => {
    it('fires alert when shipment is overdue by >24h on funded deal', async () => {
      const overdueDate = new Date();
      overdueDate.setDate(overdueDate.getDate() - 2);

      const deal = buildDeal({
        status: 'funded',
        deliveryDate: overdueDate.toISOString().split('T')[0],
      });

      await service.checkShipmentOverdue(deal);

      expect(alertRepo.create).toHaveBeenCalled();
      expect(alertRepo.save).toHaveBeenCalled();
    });

    it('does not fire alert for non-funded deals', async () => {
      const deal = buildDeal({ status: 'open' });

      await service.checkShipmentOverdue(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });

    it('does not fire alert when delivery date is in the future', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const deal = buildDeal({
        status: 'funded',
        deliveryDate: futureDate.toISOString().split('T')[0],
      });

      await service.checkShipmentOverdue(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('checkRevenueNotDistributed', () => {
    it('fires alert when completed deal has no distribution after 7 days', async () => {
      const completedDate = new Date();
      completedDate.setDate(completedDate.getDate() - 8);

      milestoneRepo.findOne.mockResolvedValue({
        recordedAt: completedDate,
      });

      const deal = buildDeal({ status: 'completed' });

      await service.checkRevenueNotDistributed(deal);

      expect(alertRepo.create).toHaveBeenCalled();
    });

    it('does not fire alert for non-completed deals', async () => {
      const deal = buildDeal({ status: 'funded' });

      await service.checkRevenueNotDistributed(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });

    it('does not fire alert when within 7 days of completion', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);

      milestoneRepo.findOne.mockResolvedValue({
        recordedAt: recentDate,
      });

      const deal = buildDeal({ status: 'completed' });

      await service.checkRevenueNotDistributed(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('does not re-fire alert if already active and unresolved', async () => {
      const existingAlert = {
        id: 'alert-existing',
        dealId: 'deal-uuid-1',
        alertType: 'funding_below_threshold',
        resolvedAt: null,
      };
      alertRepo.findOne.mockResolvedValue(existingAlert);

      const now = new Date();
      const deliveryDate = new Date(now);
      deliveryDate.setDate(deliveryDate.getDate() + 5);

      const deal = buildDeal({
        totalInvested: 1_000,
        totalValue: 10_000,
        deliveryDate: deliveryDate.toISOString().split('T')[0],
      });

      await service.checkFundingBelowThreshold(deal);

      expect(alertRepo.create).not.toHaveBeenCalled();
      expect(alertRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('runHealthChecks', () => {
    it('evaluates all open and funded deals', async () => {
      const deals = [
        buildDeal({ status: 'open' }),
        buildDeal({ id: 'deal-2', status: 'funded' }),
      ];
      tradeDealRepo.find.mockResolvedValue(deals);
      investmentRepo.findOne.mockResolvedValue({ createdAt: new Date() });

      await service.runHealthChecks();

      expect(tradeDealRepo.find).toHaveBeenCalled();
    });
  });
});
