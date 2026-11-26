import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController, PublicController } from './app.controller';
import { TradeDeal } from './trade-deals/entities/trade-deal.entity';
import { Investment } from './investments/entities/investment.entity';
import { PublicStatsService } from './public-stats/public-stats.service';

describe('AppController & PublicController', () => {
  let controller: AppController;
  let publicController: PublicController;
  let configService: Partial<ConfigService>;
  let publicStatsService: { getPublicStats: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const mockConfig: Record<string, any> = {
          STELLAR_NETWORK: 'testnet',
          PLATFORM_FEE_PERCENT: '2.5',
          TOKEN_PRICE_USD: '100',
          ALLOWED_COUNTRIES: 'US,KE,NG,GH',
          STATS_TOTAL_FUNDED: '2840000',
          STATS_ACTIVE_FARMERS: '384',
          STATS_DEALS_COMPLETED: '142',
          STATS_AVG_RETURN: '14.8',
        };
        return mockConfig[key] ?? defaultValue;
      }),
    };

    publicStatsService = {
      getPublicStats: jest.fn().mockResolvedValue({
        total_deals_completed: 142,
        active_deals: 24,
        total_capital_deployed_usd: 2840000,
        avg_yield_pct: 14.8,
        on_time_delivery_rate: 94.5,
        top_5_commodities: [],
        monthly_capital_deployed: [],
        cache_ttl_seconds: 300,
        updated_at: '2026-11-26T08:00:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [CacheModule.register()],
      controllers: [AppController, PublicController],
      providers: [
        { provide: ConfigService, useValue: configService },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: { count: jest.fn() },
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: { count: jest.fn(), createQueryBuilder: jest.fn() },
        },
        { provide: PublicStatsService, useValue: publicStatsService },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
    publicController = module.get<PublicController>(PublicController);
  });

  it('should return platform public configuration', () => {
    const config = controller.getConfig();
    expect(config.stellarNetwork).toBe('testnet');
    expect(config.platformFeePercent).toBe(2.5);
    expect(config.tokenPriceUsd).toBe(100);
    expect(config.allowedCountries).toEqual(['US', 'KE', 'NG', 'GH']);
  });

  it('should return cached live platform stats with formatted values', () => {
    const stats = controller.getPlatformStats();
    expect(stats.totalFunded).toBe(2840000);
    expect(stats.totalFundedFormatted).toBe('$2.8M+');
    expect(stats.activeFarmers).toBe(384);
    expect(stats.activeFarmersFormatted).toBe('384+');
    expect(stats.dealsCompleted).toBe(142);
    expect(stats.dealsCompletedFormatted).toBe('142+');
    expect(stats.avgReturn).toBe(14.8);
    expect(stats.avgReturnFormatted).toBe('14.8%');
    expect(stats.updatedAt).toBeDefined();

    // Second call should return cached instance
    const stats2 = controller.getPlatformStats();
    expect(stats2.updatedAt).toBe(stats.updatedAt);
  });

  it('GET /public/stats delegates to PublicStatsService', async () => {
    const result = await publicController.getPublicStats();
    expect(result.total_deals_completed).toBe(142);
    expect(publicStatsService.getPublicStats).toHaveBeenCalledTimes(1);
  });
});
