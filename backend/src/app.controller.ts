import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';

export interface PublicPlatformStats {
  totalFunded: number;
  totalFundedFormatted: string;
  activeFarmers: number;
  activeFarmersFormatted: string;
  dealsCompleted: number;
  dealsCompletedFormatted: string;
  avgReturn: number;
  avgReturnFormatted: string;
  updatedAt: string;
}

@ApiTags('config')
@UseInterceptors(ETagInterceptor)
@Controller('config')
export class AppController {
  private cachedConfig: Record<string, unknown> | null = null;
  private cachedStats: PublicPlatformStats | null = null;
  private statsCachedAt: number = 0;

  constructor(private readonly config: ConfigService) {}

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

  @Get('stats')
  @ApiOperation({ summary: 'Return cached public platform live statistics' })
  @ApiResponse({ status: 200, description: 'Public platform metrics cached with 60s TTL' })
  getPlatformStats(): PublicPlatformStats {
    const now = Date.now();
    const cacheTtlMs = 60 * 1000; // 60s TTL cache

    if (this.cachedStats && now - this.statsCachedAt < cacheTtlMs) {
      return this.cachedStats;
    }

    const totalFunded = parseFloat(
      this.config.get<string>('STATS_TOTAL_FUNDED', '2840000'),
    );
    const activeFarmers = parseInt(
      this.config.get<string>('STATS_ACTIVE_FARMERS', '384'),
      10,
    );
    const dealsCompleted = parseInt(
      this.config.get<string>('STATS_DEALS_COMPLETED', '142'),
      10,
    );
    const avgReturn = parseFloat(
      this.config.get<string>('STATS_AVG_RETURN', '14.8'),
    );

    this.cachedStats = {
      totalFunded,
      totalFundedFormatted: `$${(totalFunded / 1000000).toFixed(1)}M+`,
      activeFarmers,
      activeFarmersFormatted: `${activeFarmers}+`,
      dealsCompleted,
      dealsCompletedFormatted: `${dealsCompleted}+`,
      avgReturn,
      avgReturnFormatted: `${avgReturn.toFixed(1)}%`,
      updatedAt: new Date().toISOString(),
    };
    this.statsCachedAt = now;

    return this.cachedStats;
  }
}
