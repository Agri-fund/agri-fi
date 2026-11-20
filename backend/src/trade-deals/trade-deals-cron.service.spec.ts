jest.mock('./deal-suggestions.service', () => ({}), { virtual: true });

import { TradeDealsCronService } from './trade-deals-cron.service';
import { InvestmentStatus } from '../investments/entities/investment.entity';

describe('TradeDealsCronService', () => {
  let repo: any;
  let tradeDealsService: any;
  let riskScoringService: any;
  let logger: any;
  let investmentRepo: any;
  let queueService: any;
  let service: TradeDealsCronService;

  let investmentQb: any;

  beforeEach(() => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    tradeDealsService = {
      expireDeal: jest.fn().mockResolvedValue(undefined),
      closeUnderfundedDeal: jest.fn().mockResolvedValue(undefined),
    };

    riskScoringService = {
      recalculateAll: jest.fn().mockResolvedValue(undefined),
    };

    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    investmentQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    investmentRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(investmentQb),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    queueService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    service = new TradeDealsCronService(
      repo,
      tradeDealsService,
      riskScoringService,
      logger,
      investmentRepo,
      queueService,
    );
  });

  describe('expireOverdueDeals', () => {
    it('filters for open deals that missed the funding target by the deadline', async () => {
      await service.expireOverdueDeals();

      const qb = (repo.createQueryBuilder as jest.Mock).mock.results[0].value;
      expect(qb.where).toHaveBeenCalledWith('deal.status = :status', { status: 'open' });
      expect(qb.andWhere).toHaveBeenNthCalledWith(
        1,
        'COALESCE(deal.funding_deadline, deal.delivery_date) < :now',
        { now: expect.any(Date) },
      );
      expect(qb.andWhere).toHaveBeenNthCalledWith(
        2,
        'deal.total_invested < COALESCE(deal.minimum_funding_target, deal.total_value)',
      );
    });
  });

  describe('refundPendingInvestmentsOnExpiredDeals (#1007, #1318)', () => {
    const investments = [
      { id: 'inv-1', investorId: 'user-1', tradeDealId: 'deal-1', amountUsd: 500 },
      { id: 'inv-2', investorId: 'user-2', tradeDealId: 'deal-1', amountUsd: 250 },
    ];

    it('does nothing when no pending investments exist on expired deals', async () => {
      investmentQb.getMany.mockResolvedValue([]);

      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(investmentRepo.update).not.toHaveBeenCalled();
      expect(queueService.emit).not.toHaveBeenCalled();
    });

    it('queries only pending investments joined to expired deals', async () => {
      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(investmentRepo.createQueryBuilder).toHaveBeenCalledWith('inv');
      expect(investmentQb.innerJoin).toHaveBeenCalledWith('inv.tradeDeal', 'deal');
      expect(investmentQb.where).toHaveBeenCalledWith('inv.status = :status', {
        status: InvestmentStatus.PENDING,
      });
      expect(investmentQb.andWhere).toHaveBeenCalledWith('deal.status = :dealStatus', {
        dealStatus: 'expired',
      });
    });

    it('queues a stellar.clawback job for every investment before marking them REFUNDED (#1318)', async () => {
      investmentQb.getMany.mockResolvedValue(investments);

      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(queueService.emit).toHaveBeenCalledWith('stellar.clawback', {
        investmentId: 'inv-1',
        tradeDealId: 'deal-1',
        investorId: 'user-1',
        amountUsd: 500,
        reason: 'deal_expired',
      });
      expect(queueService.emit).toHaveBeenCalledWith('stellar.clawback', {
        investmentId: 'inv-2',
        tradeDealId: 'deal-1',
        investorId: 'user-2',
        amountUsd: 250,
        reason: 'deal_expired',
      });

      const emitMock = queueService.emit as jest.Mock;
      const clawbackCalls = emitMock.mock.calls.filter(
        ([pattern]) => pattern === 'stellar.clawback',
      );
      expect(clawbackCalls).toHaveLength(2);

      const updateOrder = (investmentRepo.update as jest.Mock).mock
        .invocationCallOrder[0];
      emitMock.mock.calls.forEach(([pattern], index) => {
        if (pattern === 'stellar.clawback') {
          expect(emitMock.mock.invocationCallOrder[index]).toBeLessThan(
            updateOrder,
          );
        }
      });
    });

    it('bulk-updates only investments whose clawback job was queued', async () => {
      investmentQb.getMany.mockResolvedValue(investments);

      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(investmentRepo.update).toHaveBeenCalledWith(
        ['inv-1', 'inv-2'],
        { status: InvestmentStatus.REFUNDED },
      );
    });

    it('never marks an investment REFUNDED when its clawback job cannot be queued (#1318)', async () => {
      investmentQb.getMany.mockResolvedValue(investments);
      queueService.emit.mockImplementation(async (pattern: string, payload: any) => {
        if (pattern === 'stellar.clawback' && payload.investmentId === 'inv-1') {
          throw new Error('queue down');
        }
      });

      await expect(
        service.refundPendingInvestmentsOnExpiredDeals(),
      ).resolves.not.toThrow();

      expect(investmentRepo.update).toHaveBeenCalledWith(
        ['inv-2'],
        { status: InvestmentStatus.REFUNDED },
      );
      expect(queueService.emit).not.toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({ investorId: 'user-1' }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ investmentId: 'inv-1' }),
        expect.any(String),
      );
    });

    it('marks nothing REFUNDED when every clawback queue emit fails (#1318)', async () => {
      investmentQb.getMany.mockResolvedValue(investments);
      queueService.emit.mockImplementation(async (pattern: string) => {
        if (pattern === 'stellar.clawback') throw new Error('queue down');
      });

      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(investmentRepo.update).not.toHaveBeenCalled();
      expect(queueService.emit).not.toHaveBeenCalledWith(
        'email.notification',
        expect.anything(),
      );
    });

    it('emits an email notification for each refunded investment', async () => {
      investmentQb.getMany.mockResolvedValue(investments);

      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(queueService.emit).toHaveBeenCalledWith('email.notification', {
        type: 'investment_refunded_deal_expired',
        investorId: 'user-1',
        tradeDealId: 'deal-1',
        amountUsd: 500,
      });
      expect(queueService.emit).toHaveBeenCalledWith('email.notification', {
        type: 'investment_refunded_deal_expired',
        investorId: 'user-2',
        tradeDealId: 'deal-1',
        amountUsd: 250,
      });
    });

    it('is idempotent — a second run finds no PENDING investments left', async () => {
      investmentQb.getMany
        .mockResolvedValueOnce([investments[0]])
        .mockResolvedValueOnce([]);

      await service.refundPendingInvestmentsOnExpiredDeals();
      await service.refundPendingInvestmentsOnExpiredDeals();

      expect(investmentRepo.update).toHaveBeenCalledTimes(1);
      expect(
        (queueService.emit as jest.Mock).mock.calls.filter(
          ([pattern]) => pattern === 'stellar.clawback',
        ),
      ).toHaveLength(1);
    });

    it('continues processing remaining investments when a notification emit fails', async () => {
      investmentQb.getMany.mockResolvedValue(investments);
      queueService.emit.mockImplementation(async (pattern: string, payload: any) => {
        if (pattern === 'email.notification' && payload.investorId === 'user-1') {
          throw new Error('queue down');
        }
      });

      await expect(
        service.refundPendingInvestmentsOnExpiredDeals(),
      ).resolves.not.toThrow();

      expect(investmentRepo.update).toHaveBeenCalledWith(
        ['inv-1', 'inv-2'],
        { status: InvestmentStatus.REFUNDED },
      );
      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({ investorId: 'user-2' }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ investmentId: 'inv-1' }),
        expect.any(String),
      );
    });
  });
});
