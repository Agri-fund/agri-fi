import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';

describe('AppController (Issue #1013)', () => {
  let controller: AppController;
  let configService: Partial<ConfigService>;

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
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
});
