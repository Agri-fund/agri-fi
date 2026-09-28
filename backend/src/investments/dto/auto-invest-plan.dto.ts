import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsString,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
  IsPositive,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAutoInvestPlanDto {
  @ApiProperty({
    description: 'Amount in USD to allocate per run',
    example: 500,
    minimum: 100,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(100, { message: 'Minimum allocation is $100 (one token)' })
  amountUsd: number;

  @ApiProperty({
    enum: ['weekly', 'biweekly', 'monthly'],
    description: 'Recurring allocation cadence',
    example: 'monthly',
  })
  @IsIn(['weekly', 'biweekly', 'monthly'])
  cadence: 'weekly' | 'biweekly' | 'monthly';

  @ApiProperty({
    description: 'Stellar wallet address used as the funding source',
    example: 'GABCDEF12345',
  })
  @IsString()
  fundingWallet: string;

  @ApiPropertyOptional({
    description: 'Maximum acceptable risk score (0-100). Deals above this are skipped.',
    example: 75,
    minimum: 0,
    maximum: 100,
    default: 75,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxRiskScore?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Commodity whitelist. Omit or set to null for any commodity.',
    example: ['cocoa', 'coffee'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  dealTypeFilter?: string[] | null;

  @ApiPropertyOptional({
    description: 'Maximum USD to allocate in a single calendar day (safety cap)',
    example: 2000,
    minimum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  dailyCapUsd?: number | null;
}

export class UpdateAutoInvestPlanDto {
  @ApiPropertyOptional({ example: 500, minimum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  amountUsd?: number;

  @ApiPropertyOptional({ enum: ['weekly', 'biweekly', 'monthly'] })
  @IsOptional()
  @IsIn(['weekly', 'biweekly', 'monthly'])
  cadence?: 'weekly' | 'biweekly' | 'monthly';

  @ApiPropertyOptional({ example: 'GABCDEF12345' })
  @IsOptional()
  @IsString()
  fundingWallet?: string;

  @ApiPropertyOptional({ example: 75, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxRiskScore?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  dealTypeFilter?: string[] | null;

  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  dailyCapUsd?: number | null;
}

export class PauseAutoInvestPlanDto {
  @ApiProperty({ description: 'Set to true to pause, false to resume', example: true })
  @IsBoolean()
  paused: boolean;
}

export class AutoInvestPlanResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() investorId: string;
  @ApiProperty() amountUsd: string;
  @ApiProperty({ enum: ['weekly', 'biweekly', 'monthly'] }) cadence: string;
  @ApiProperty() fundingWallet: string;
  @ApiProperty() maxRiskScore: string;
  @ApiPropertyOptional({ type: [String] }) dealTypeFilter: string[] | null;
  @ApiProperty({ enum: ['active', 'paused', 'cancelled'] }) status: string;
  @ApiPropertyOptional() dailyCapUsd: string | null;
  @ApiProperty() consecutiveFailures: number;
  @ApiProperty() nextRunAt: string;
  @ApiPropertyOptional() lastRunAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
