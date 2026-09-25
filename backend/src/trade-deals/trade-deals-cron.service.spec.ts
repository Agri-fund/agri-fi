import { TradeDealsCronService } from './trade-deals-cron.service';

describe('TradeDealsCronService', () => {
  let repo: any;
  let tradeDealsService: any;
  let riskScoringService: any;
  let logger: any;
  let service: TradeDealsCronService;

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

    service = new TradeDealsCronService(
      repo,
      tradeDealsService,
      riskScoringService,
      logger,
    );
  });

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