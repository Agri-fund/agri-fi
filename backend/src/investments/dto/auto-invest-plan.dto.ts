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
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAutoInvestPlanDto {
  @ApiPropertyOptional({ example: 'Africa cocoa growth' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

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

  @ApiPropertyOptional({ description: 'Minimum expected deal ROI percentage', example: 15, minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  minimumExpectedRoi?: number | null;

  @ApiPropertyOptional({ type: [String], description: 'Case-insensitive region names matched against deal location' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  regionFilter?: string[] | null;

  @ApiPropertyOptional({ description: 'Maximum deal duration in days', example: 365, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxDurationDays?: number | null;

  @ApiPropertyOptional({ description: 'Maximum strategy allocation to one matched deal in USD', example: 5000, minimum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  maxPositionUsd?: number | null;
}

export class UpdateAutoInvestPlanDto {
  @ApiPropertyOptional({ example: 'Africa cocoa growth', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

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

  @ApiPropertyOptional({ example: 15, minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  minimumExpectedRoi?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  regionFilter?: string[] | null;

  @ApiPropertyOptional({ example: 365, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxDurationDays?: number | null;

  @ApiPropertyOptional({ example: 5000, minimum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  maxPositionUsd?: number | null;

  @ApiPropertyOptional({ description: 'Allow other investors to view this strategy criteria' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class PauseAutoInvestPlanDto {
  @ApiProperty({ description: 'Set to true to pause, false to resume', example: true })
  @IsBoolean()
  paused: boolean;
}

export class AutoInvestPlanResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() investorId: string;
  @ApiProperty() name: string;
  @ApiProperty() amountUsd: string;
  @ApiProperty({ enum: ['weekly', 'biweekly', 'monthly'] }) cadence: string;
  @ApiProperty() fundingWallet: string;
  @ApiProperty() maxRiskScore: string;
  @ApiPropertyOptional({ type: [String] }) dealTypeFilter: string[] | null;
  @ApiPropertyOptional() minimumExpectedRoi: string | null;
  @ApiPropertyOptional({ type: [String] }) regionFilter: string[] | null;
  @ApiPropertyOptional() maxDurationDays: number | null;
  @ApiPropertyOptional() maxPositionUsd: string | null;
  @ApiProperty() isPublic: boolean;
  @ApiProperty() version: number;
  @ApiProperty({ type: [Object] }) versionHistory: AutoInvestPlanVersion[];
  @ApiProperty({ enum: ['active', 'paused', 'cancelled'] }) status: string;
  @ApiPropertyOptional() dailyCapUsd: string | null;
  @ApiProperty() consecutiveFailures: number;
  @ApiProperty() nextRunAt: string;
  @ApiPropertyOptional() lastRunAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
