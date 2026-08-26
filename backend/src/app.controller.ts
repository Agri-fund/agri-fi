import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';

@ApiTags('config')
@UseInterceptors(ETagInterceptor)
@Controller('config')
export class AppController {
  private cachedConfig: Record<string, unknown> | null = null;

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
}
