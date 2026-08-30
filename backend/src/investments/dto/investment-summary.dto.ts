import { ApiProperty } from '@nestjs/swagger';

/**
 * One deal's slice of the investor's portfolio, for the "allocation by
 * deal" breakdown (#789).
 */
export class DealAllocationDto {
  @ApiProperty({ description: 'Trade deal UUID' })
  dealId: string;

  @ApiProperty({ description: 'Commodity name, e.g. "Maize"' })
  commodity: string;

  @ApiProperty({ description: 'Trade deal token symbol' })
  tokenSymbol: string;

  @ApiProperty({
    description:
      'Total USD committed by this investor to this deal (sum of amountUsd ' +
      'across every non-cancelled, non-failed, non-refunded investment in ' +
      'the deal)',
    example: 5000,
  })
  amountUsd: number;

  @ApiProperty({
    description: "Share of the investor's total invested capital in this deal, 0-100",
    example: 32.5,
  })
  percentage: number;
}

/**
 * Response shape for `GET /investments/summary` (#789).
 */
export class InvestmentSummaryDto {
  @ApiProperty({
    description:
      'Total USD ever committed across confirmed/active/releasing/completed ' +
      'investments (cost basis). Excludes pending (not yet funded on-chain) ' +
      'and cancelled/failed/refunded investments.',
    example: 25000,
  })
  totalInvested: number;

  @ApiProperty({
    description:
      "Estimated current worth of the portfolio: for completed investments, " +
      "cost basis grown by the deal's expected ROI (realized); for still-" +
      'active investments, cost basis (no secondary-market mark-to-market ' +
      'yet). Always >= totalInvested when every deal has a non-negative ROI.',
    example: 26200,
  })
  currentValue: number;

  @ApiProperty({
    description:
      "Projected total value if every active deal's expected ROI is realized " +
      '(cost basis grown by expectedRoi for confirmed/active/releasing ' +
      'investments, plus the realized value of completed ones)',
    example: 27500,
  })
  expectedReturns: number;

  @ApiProperty({
    description:
      'Number of distinct trade deals this investor currently holds a ' +
      'live position in (confirmed, active, or releasing — not pending, ' +
      'not completed, not cancelled/failed/refunded)',
    example: 4,
  })
  activeDealCount: number;

  @ApiProperty({
    type: [DealAllocationDto],
    description:
      'Portfolio allocation broken down by deal, sorted by amountUsd ' +
      'descending. Percentages sum to ~100 (subject to rounding).',
  })
  allocationByDeal: DealAllocationDto[];
}
