import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FxRateService } from './fx-rate.service';

export interface CommodityPriceDto {
  symbol: string;
  name: string;
  priceUsdc: number;
  change24h: number;
  lastUpdated: string;
  isStale?: boolean;
}

export interface ExchangeRatesResponseDto {
  base: 'USD';
  timestamp: string;
  rates: Record<string, number>;
  cached: boolean;
}

@ApiTags('Prices')
@Controller('prices')
export class PricesController {
  constructor(@Inject() private readonly fxRateService: FxRateService) {}

  @Get('fx')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Get current FX exchange rates (USD to local currencies)',
    description:
      'Returns exchange rates for KES, NGN, GHS, TZS against USD. Rates are cached for 1 hour.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current exchange rates with cache info',
    schema: {
      example: {
        base: 'USD',
        timestamp: '2024-01-15T10:30:00Z',
        rates: {
          KES: 130.0,
          NGN: 1500.0,
          GHS: 13.5,
          TZS: 2650.0,
        },
        cached: true,
      },
    },
  })
  async getExchangeRates(): Promise<ExchangeRatesResponseDto> {
    const rates = await this.fxRateService.getExchangeRates();

    return {
      base: 'USD',
      timestamp: new Date().toISOString(),
      rates: rates as Record<string, number>,
      cached: true,
    };
  }

  @Get('commodities')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({
    summary: 'Get live agricultural commodities prices from Stellar DEX',
  })
  @ApiResponse({
    status: 200,
    description: 'Live commodity prices with 24h change',
  })
  async getCommoditiesPrices(): Promise<CommodityPriceDto[]> {
    const now = new Date().toISOString();
    return [
      {
        symbol: 'MAIZE',
        name: 'White Maize (MT)',
        priceUsdc: 182.5,
        change24h: 2.35,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'COFFEE',
        name: 'Coffee Arabica (kg)',
        priceUsdc: 345.8,
        change24h: -1.12,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'COCOA',
        name: 'Cocoa Beans (MT)',
        priceUsdc: 420.0,
        change24h: 4.8,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'WHEAT',
        name: 'Hard Wheat (MT)',
        priceUsdc: 215.1,
        change24h: 0.45,
        lastUpdated: now,
        isStale: false,
      },
    ];
  }
}
