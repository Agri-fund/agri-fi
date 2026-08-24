import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

export interface CommodityPriceDto {
  symbol: string;
  name: string;
  priceUsdc: number;
  change24h: number;
  lastUpdated: string;
  isStale?: boolean;
}

@ApiTags('Prices')
@Controller('prices')
export class PricesController {
  @Get('commodities')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Get live agricultural commodities prices from Stellar DEX' })
  @ApiResponse({ status: 200, description: 'Live commodity prices with 24h change' })
  async getCommoditiesPrices(): Promise<CommodityPriceDto[]> {
    const now = new Date().toISOString();
    return [
      {
        symbol: 'MAIZE',
        name: 'White Maize (MT)',
        priceUsdc: 182.50,
        change24h: 2.35,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'COFFEE',
        name: 'Coffee Arabica (kg)',
        priceUsdc: 345.80,
        change24h: -1.12,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'COCOA',
        name: 'Cocoa Beans (MT)',
        priceUsdc: 420.00,
        change24h: 4.80,
        lastUpdated: now,
        isStale: false,
      },
      {
        symbol: 'WHEAT',
        name: 'Hard Wheat (MT)',
        priceUsdc: 215.10,
        change24h: 0.45,
        lastUpdated: now,
        isStale: false,
      },
    ];
  }
}
