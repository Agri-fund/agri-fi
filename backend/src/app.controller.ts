import { Controller, Get, UseInterceptors, CacheInterceptor, CacheTTL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from './trade-deals/entities/trade-deal.entity';
import { Investment } from './investments/entities/investment.entity';

@ApiTags('config')
@UseInterceptors(ETagInterceptor)
@Controller('config')
export class AppController {
  private cachedConfig: Record<string, unknown> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Return public platform configuration' })
  @ApiResponse({ status: 200, description: 'Public configuration values' })
  getConfig(): Record<string, unknown> {
    if (!this.cachedConfig) {
      this.cachedConfig = {
        stellarNetwork: this.config.get<string>('STELLAR_NETWORK', 'testnet'),
        platformFeePercent: parseFloat(
          this.config.get<string>('PLATFORM_FEE_PERCENT', '2'),
        ),
        tokenPriceUsd: parseFloat(
          this.config.get<string>('TOKEN_PRICE_USD', '100'),
        ),
        allowedCountries: (
          this.config.get<string>('ALLOWED_COUNTRIES', '') || ''
        )
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      };
    }
    return this.cachedConfig;
  }
}

@ApiTags('public')
@Controller('public')
export class PublicController {
  private marketDataCache: {
    data: any;
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL = 60000; // 60 seconds

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  @Get('market')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60)
  @ApiOperation({
    summary: 'Get public market data (prices, volume, deal counts) - #1027',
  })
  @ApiResponse({
    status: 200,
    description: 'Public market data with 60s cache',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async getMarketData() {
    const now = Date.now();

    if (
      this.marketDataCache &&
      now - this.marketDataCache.timestamp < this.CACHE_TTL
    ) {
      return this.marketDataCache.data;
    }

    const [totalDeals, openDeals, totalInvestments, totalVolume] =
      await Promise.all([
        this.tradeDealRepo.count(),
        this.tradeDealRepo.count({ where: { status: 'open' } }),
        this.investmentRepo.count(),
        this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(inv.amountUsd)', 'total')
          .getRawOne()
          .then((result) => parseFloat(result.total || '0')),
      ]);

    const data = {
      prices: {
        tokenPriceUsd: 100,
        platformFeePercent: 2,
      },
      volume: {
        totalInvestments,
        totalVolumeUsd: totalVolume.toFixed(2),
      },
      dealCounts: {
        totalDeals,
        openDeals,
        closedDeals: totalDeals - openDeals,
      },
      timestamp: new Date().toISOString(),
    };

    this.marketDataCache = {
      data,
      timestamp: now,
    };

    return data;
  }
}
