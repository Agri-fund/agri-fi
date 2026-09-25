import { ApiProperty } from '@nestjs/swagger';
import { FeeLineItemDto } from './fee-line-item.dto';

/**
 * Complete fee breakdown for an investment
 */
export class FeeBreakdownDto {
  @ApiProperty({
    description: 'Original investment amount in USD',
    example: 10000.0,
  })
  grossAmount: number;

  @ApiProperty({
    type: FeeLineItemDto,
    nullable: true,
    description: 'Platform origination fee (charged to farmer at funding)',
    example: {
      type: 'platform_origination',
      description: 'Platform origination fee',
      ratePercent: 2.0,
      amount: 200.0,
      effectiveFrom: '2024-01-01T00:00:00Z',
    },
  })
  platformOriginationFee: FeeLineItemDto | null;

  @ApiProperty({
    type: FeeLineItemDto,
    nullable: true,
    description: 'Platform success fee (charged to farmer at payout)',
    example: {
      type: 'platform_success',
      description: 'Platform success fee',
      ratePercent: 0.5,
      amount: 50.0,
      effectiveFrom: '2024-01-01T00:00:00Z',
    },
  })
  platformSuccessFee: FeeLineItemDto | null;

  @ApiProperty({
    type: FeeLineItemDto,
    nullable: true,
    description:
      'Investor entry fee (charged to investor, reduces net investment)',
    example: {
      type: 'investor_entry',
      description: 'Investor entry fee (retail)',
      ratePercent: 1.0,
      amount: 100.0,
      effectiveFrom: '2024-01-01T00:00:00Z',
    },
  })
  investorEntryFee: FeeLineItemDto | null;

  @ApiProperty({
    type: FeeLineItemDto,
    nullable: true,
    description: 'Early exit penalty fee (if investor exits before maturity)',
    example: null,
  })
  earlyExitFee: FeeLineItemDto | null;

  @ApiProperty({
    description: 'Total fees in USD (sum of all applicable fees)',
    example: 350.0,
  })
  totalFees: number;

  @ApiProperty({
    description:
      'Net amount actually invested after deducting investor entry fees',
    example: 9900.0,
  })
  netInvestmentAmount: number;

  @ApiProperty({
    type: [FeeLineItemDto],
    description: 'Array of all applicable fees for this investment',
  })
  breakdown: FeeLineItemDto[];
}
