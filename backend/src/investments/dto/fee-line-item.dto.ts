import { ApiProperty } from '@nestjs/swagger';
import { FeeType } from '../../database/entities/fee-configuration.entity';

/**
 * Represents a single fee line item in the breakdown
 */
export class FeeLineItemDto {
  @ApiProperty({
    enum: [
      'platform_origination',
      'platform_success',
      'investor_entry',
      'early_exit',
    ],
    description: 'Type of fee',
    example: 'platform_origination',
  })
  type: FeeType;

  @ApiProperty({
    description: 'Human-readable description of this fee',
    example: 'Platform origination fee',
  })
  description: string;

  @ApiProperty({
    description: 'Fee rate as percentage',
    example: 2.0,
  })
  ratePercent: number;

  @ApiProperty({
    description: 'Calculated fee amount in USD',
    example: 200.0,
  })
  amount: number;

  @ApiProperty({
    description: 'When this fee configuration became effective',
    example: '2024-01-01T00:00:00Z',
  })
  effectiveFrom: Date;
}
