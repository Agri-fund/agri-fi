import { ApiProperty } from '@nestjs/swagger';
import { FeeBreakdownDto } from './fee-breakdown.dto';

/**
 * Response DTO for investment creation and retrieval
 * Includes complete fee breakdown
 */
export class InvestmentResponseDto {
  @ApiProperty({
    description: 'Unique investment identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Associated trade deal UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  tradeDealId: string;

  @ApiProperty({
    description: 'Investor user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  investorId: string;

  @ApiProperty({
    description: 'Number of tokens purchased',
    example: 100,
  })
  tokenAmount: number;

  @ApiProperty({
    description: 'Investment amount in USD (gross, before fees)',
    example: 10000.0,
  })
  amountUsd: number;

  @ApiProperty({
    type: FeeBreakdownDto,
    description: 'Complete itemized fee breakdown',
  })
  feeBreakdown: FeeBreakdownDto;

  @ApiProperty({
    description: 'Investment status (pending, confirmed, failed, refunded)',
    enum: ['pending', 'confirmed', 'failed', 'refunded'],
    example: 'pending',
  })
  status: string;

  @ApiProperty({
    description: 'Stellar transaction ID (set once confirmed on-chain)',
    nullable: true,
    example: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  stellarTxId: string | null;

  @ApiProperty({
    description: 'Investment creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;
}

/**
 * Response DTO for creating investment that includes unsigned XDR for signing
 */
export class CreateInvestmentResponseDto extends InvestmentResponseDto {
  @ApiProperty({
    description: 'Unsigned Stellar transaction XDR for investor to sign',
    example: 'AAAAAgAAAAD...',
  })
  unsignedXdr: string;
}
