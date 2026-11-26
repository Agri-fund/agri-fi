import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import {
  PUBLIC_STATS_CACHE_TTL_MS,
  PublicStatsService,
} from './public-stats.service';

function makeQueryBuilderMock(overrides: {
  getCount?: number;
  getRawOne?: unknown;
  getRawMany?: unknown[];
  getMany?: unknown[];
}) {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(overrides.getCount ?? 0),
    getRawOne: jest.fn().mockResolvedValue(overrides.getRawOne ?? {}),
    getRawMany: jest.fn().mockResolvedValue(overrides.getRawMany ?? []),
    getMany: jest.fn().mockResolvedValue(overrides.getMany ?? []),
  };
  return qb;
}

describe('PublicStatsService (#1396)', () => {
  let service: PublicStatsService;
  let tradeDealRepo: {
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let investmentRepo: {
    createQueryBuilder: jest.Mock;
  };
  let milestoneRepo: {
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    tradeDealRepo = {
      count: jest.fn().mockResolvedValue(14),
      createQueryBuilder: jest
        .fn()
        // 1st call: active_deals
        .mockReturnValueOnce(makeQueryBuilderMock({ getCount: 6 }))
        // 2nd call: avg_yield_pct
        .mockReturnValueOnce(
          makeQueryBuilderMock({ getRawOne: { avg: '15.25' } }),
        )
        // 3rd call: delivered deals for on-time rate
        .mockReturnValueOnce(
          makeQueryBuilderMock({
            getMany: [
              { id: 'd1', deliveryDate: new Date('2026-06-15') },
              { id: 'd2', deliveryDate: new Date('2026-06-10') },
            ],
          }),
        )
        // 4th call: top 5 commodities
        .mockReturnValueOnce(
          makeQueryBuilderMock({
            getRawMany: [
              { commodity: 'Cocoa', dealCount: '5', totalVolumeUsd: '250000' },
              { commodity: 'Coffee', dealCount: '3', totalVolumeUsd: '120000' },
            ],
          }),
        ),
    };

    investmentRepo = {
      createQueryBuilder: jest
        .fn()
        // 1st call: total_capital_deployed_usd
        .mockReturnValueOnce(
          makeQueryBuilderMock({ getRawOne: { total: '370000' } }),
        )
        // 2nd call: monthly_capital_deployed
        .mockReturnValueOnce(
          makeQueryBuilderMock({
            getRawMany: [
              {
                month: '2026-11',
                capitalDeployedUsd: '150000',
                dealCount: '3',
              },
            ],
          }),
        ),
    };

    milestoneRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(
        makeQueryBuilderMock({
          getMany: [
            {
              tradeDealId: 'd1',
              recordedAt: new Date('2026-06-14T12:00:00Z'), // on time
            },
            {
              tradeDealId: 'd2',
              recordedAt: new Date('2026-06-12T12:00:00Z'), // late
            },
          ],
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicStatsService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
      ],
    }).compile();

    service = module.get<PublicStatsService>(PublicStatsService);
  });

  it('computes aggregate platform metrics and caches for 5 minutes', async () => {
    const t0 = new Date('2026-11-26T08:00:00Z').getTime();
    const stats = await service.getPublicStats(t0);

    expect(stats.total_deals_completed).toBe(14);
    expect(stats.active_deals).toBe(6);
    expect(stats.total_capital_deployed_usd).toBe(370000);
    expect(stats.avg_yield_pct).toBe(15.25);
    expect(stats.on_time_delivery_rate).toBe(50);
    expect(stats.top_5_commodities).toEqual([
      { commodity: 'Cocoa', deal_count: 5, total_volume_usd: 250000 },
      { commodity: 'Coffee', deal_count: 3, total_volume_usd: 120000 },
    ]);
    expect(stats.monthly_capital_deployed).toHaveLength(12);
    expect(stats.monthly_capital_deployed[11]).toMatchObject({
      month: '2026-11',
      capital_deployed_usd: 150000,
      deal_count: 3,
    });
    expect(stats.cache_ttl_seconds).toBe(300);

    // Within 5-minute TTL -> served from cache without hitting repositories again
    const cached = await service.getPublicStats(t0 + 60_000);
    expect(cached).toBe(stats);
    expect(tradeDealRepo.count).toHaveBeenCalledTimes(1);

    // Past 5-minute TTL -> recomputes
    tradeDealRepo.createQueryBuilder
      .mockReturnValueOnce(makeQueryBuilderMock({ getCount: 7 }))
      .mockReturnValueOnce(makeQueryBuilderMock({ getRawOne: { avg: '16' } }))
      .mockReturnValueOnce(makeQueryBuilderMock({ getMany: [] }))
      .mockReturnValueOnce(makeQueryBuilderMock({ getRawMany: [] }));
    investmentRepo.createQueryBuilder
      .mockReturnValueOnce(
        makeQueryBuilderMock({ getRawOne: { total: '400000' } }),
      )
      .mockReturnValueOnce(makeQueryBuilderMock({ getRawMany: [] }));

    const refreshed = await service.getPublicStats(
      t0 + PUBLIC_STATS_CACHE_TTL_MS + 1,
    );
    expect(refreshed.active_deals).toBe(7);
    expect(tradeDealRepo.count).toHaveBeenCalledTimes(2);
  });
});
