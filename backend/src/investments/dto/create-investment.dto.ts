import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsNotEmpty,
  IsInt,
  Min,
  IsObject,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvestmentDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the trade deal to invest in',
  })
  @IsUUID()
  @IsNotEmpty()
  tradeDealId: string;

  @ApiProperty({
    example: 5,
    minimum: 1,
    description: 'Number of Trade_Tokens to purchase (each = $100 USD)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tokenAmount: number;

  @ApiProperty({
    example: 500,
    description: 'Investment amount in USD (must match tokenAmount × 100)',
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountUsd: number;

  @ApiProperty({
    required: false,
    description:
      'Originator and beneficiary metadata for FATF Travel Rule readiness on large transfers.',
    example: {
      originator: { name: 'Ada Investor', walletAddress: 'GINVESTOR...' },
      beneficiary: { name: 'Agri-Fi Escrow', walletAddress: 'GESCROW...' },
    },
  })
  @IsOptional()
  @IsObject()
  complianceData?: Record<string, unknown>;
}
