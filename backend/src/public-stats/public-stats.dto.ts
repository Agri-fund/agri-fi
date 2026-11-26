import { ApiProperty } from '@nestjs/swagger';

export class TopCommodityStatDto {
  @ApiProperty({ example: 'Cocoa' })
  commodity: string;

  @ApiProperty({ example: 18 })
  deal_count: number;

  @ApiProperty({ example: 850000 })
  total_volume_usd: number;
}

export class MonthlyCapitalDeployedDto {
  @ApiProperty({ example: '2026-01' })
  month: string;

  @ApiProperty({ example: 'Jan 2026' })
  label: string;

  @ApiProperty({ example: 245000 })
  capital_deployed_usd: number;

  @ApiProperty({ example: 6 })
  deal_count: number;
}

export class PublicStatsResponseDto {
  @ApiProperty({ example: 142 })
  total_deals_completed: number;

  @ApiProperty({ example: 24 })
  active_deals: number;

  @ApiProperty({ example: 2840000 })
  total_capital_deployed_usd: number;

  @ApiProperty({ example: 14.8 })
  avg_yield_pct: number;

  @ApiProperty({ example: 94.5 })
  on_time_delivery_rate: number;

  @ApiProperty({ type: [TopCommodityStatDto] })
  top_5_commodities: TopCommodityStatDto[];

  @ApiProperty({ type: [MonthlyCapitalDeployedDto] })
  monthly_capital_deployed: MonthlyCapitalDeployedDto[];

  @ApiProperty({ example: 300 })
  cache_ttl_seconds: number;

  @ApiProperty({ example: '2026-11-26T08:00:00.000Z' })
  updated_at: string;
}
