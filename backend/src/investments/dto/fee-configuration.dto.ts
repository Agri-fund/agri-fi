import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsDate,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FeeType, InvestorTier } from '../../database/entities/fee-configuration.entity';

export class CreateFeeConfigurationDto {
  @ApiProperty({
    description: 'Deal type / commodity name',
    example: 'Cocoa',
  })
  @IsString()
  dealType: string;

  @ApiProperty({
    description: 'Investor tier',
    enum: ['retail', 'vip', 'institutional'],
    example: 'retail',
  })
  @IsEnum(InvestorTier)
  investorTier: InvestorTier;

  @ApiProperty({
    description: 'Type of fee',
    enum: [
      'platform_origination',
      'platform_success',
      'investor_entry',
      'early_exit',
    ],
    example: 'platform_origination',
  })
  @IsEnum(FeeType)
  feeType: FeeType;

  @ApiProperty({
    description: 'Fee rate as percentage (0-100)',
    example: 2.5,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent: number;

  @ApiProperty({
    description: 'Optional description',
    required: false,
    example: 'Platform origination fee for Cocoa deals',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'When this configuration becomes effective',
    example: '2024-06-01T00:00:00Z',
  })
  @Type(() => Date)
  @IsDate()
  effectiveFrom: Date;

  @ApiProperty({
    description: 'When this configuration expires (null = indefinite)',
    required: false,
    example: null,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date | null;
}

export class UpdateFeeConfigurationDto {
  @ApiProperty({
    description: 'Fee rate as percentage',
    required: false,
    example: 3.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @ApiProperty({
    description: 'Description',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'When to expire this configuration',
    required: false,
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date | null;
}

export class ListFeeConfigurationQueryDto {
  @ApiProperty({
    description: 'Filter by deal type',
    required: false,
    example: 'Cocoa',
  })
  @IsOptional()
  @IsString()
  dealType?: string;

  @ApiProperty({
    description: 'Filter by investor tier',
    required: false,
    enum: ['retail', 'vip', 'institutional'],
  })
  @IsOptional()
  @IsEnum(InvestorTier)
  investorTier?: InvestorTier;

  @ApiProperty({
    description: 'Filter by fee type',
    required: false,
    enum: [
      'platform_origination',
      'platform_success',
      'investor_entry',
      'early_exit',
    ],
  })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

  @ApiProperty({
    description: 'Filter by active status (active/inactive)',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  active?: boolean;
}
