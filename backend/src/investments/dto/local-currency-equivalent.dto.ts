import { ApiProperty } from '@nestjs/swagger';

/**
 * Represents an amount converted to a local currency
 * Used to display investment amounts in user's preferred currency
 */
export class LocalCurrencyEquivalentDto {
  @ApiProperty({
    description: 'ISO 4217 currency code',
    example: 'KES',
    enum: ['USD', 'KES', 'NGN', 'GHS', 'TZS'],
  })
  currency: string;

  @ApiProperty({
    description: 'Amount converted to the local currency',
    example: 1300000.0,
  })
  amount: number;

  @ApiProperty({
    description: 'Exchange rate used for conversion (1 USD = rate)',
    example: 130.0,
  })
  rate: number;

  @ApiProperty({
    description: 'Timestamp when the rate was fetched',
    example: '2024-01-15T10:30:00Z',
  })
  rateTimestamp: string;
}

/**
 * Extended investment response with optional local currency equivalent
 * Returned when displayCurrency query parameter is provided
 */
export class InvestmentResponseWithCurrencyDto {
  @ApiProperty({
    description: 'Unique investment identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Investment amount in USD (base currency)',
    example: 10000.0,
  })
  amountUsd: number;

  @ApiProperty({
    type: LocalCurrencyEquivalentDto,
    nullable: true,
    description: 'Amount converted to user preferred currency',
    example: {
      currency: 'KES',
      amount: 1300000.0,
      rate: 130.0,
      rateTimestamp: '2024-01-15T10:30:00Z',
    },
  })
  localEquivalent?: LocalCurrencyEquivalentDto;
}

/**
 * Wrapper DTO for returning multiple investment amounts with currency conversion
 * Used to display dual currency format: "50 USDC (~6,500 KES)"
 */
export class DualCurrencyAmountDto {
  @ApiProperty({
    description: 'Amount in USD',
    example: 50,
  })
  usdAmount: number;

  @ApiProperty({
    description: 'Amount converted to local currency',
    example: 6500,
  })
  localAmount: number;

  @ApiProperty({
    description: 'Local currency code',
    example: 'KES',
  })
  localCurrency: string;

  @ApiProperty({
    description: 'Exchange rate used (1 USD = rate)',
    example: 130,
  })
  exchangeRate: number;

  @ApiProperty({
    description: 'Formatted string for UI display',
    example: '50 USDC (~6,500 KES)',
  })
  formatted: string;

  @ApiProperty({
    description: 'Formatted string with disclaimer for UI display',
    example: '50 USDC (~6,500 KES) - Rates updated Jan 15, 10:30 UTC',
  })
  formattedWithDisclaimer: string;
}

/**
 * Fee breakdown with local currency equivalents
 */
export class FeeBreakdownWithCurrencyDto {
  @ApiProperty({
    description: 'Gross amount in USD',
    example: 10000.0,
  })
  grossAmountUsd: number;

  @ApiProperty({
    type: LocalCurrencyEquivalentDto,
    nullable: true,
    description: 'Gross amount in local currency',
  })
  grossAmountLocal?: LocalCurrencyEquivalentDto;

  @ApiProperty({
    description: 'Total fees in USD',
    example: 350.0,
  })
  totalFeesUsd: number;

  @ApiProperty({
    type: LocalCurrencyEquivalentDto,
    nullable: true,
    description: 'Total fees in local currency',
  })
  totalFeesLocal?: LocalCurrencyEquivalentDto;

  @ApiProperty({
    description: 'Net investment amount in USD',
    example: 9650.0,
  })
  netAmountUsd: number;

  @ApiProperty({
    type: LocalCurrencyEquivalentDto,
    nullable: true,
    description: 'Net investment amount in local currency',
  })
  netAmountLocal?: LocalCurrencyEquivalentDto;
}
