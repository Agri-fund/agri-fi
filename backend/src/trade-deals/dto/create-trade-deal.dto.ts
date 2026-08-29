import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinDate,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTradeDealDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    example: 'Cocoa for Coastal Cooperatives',
    description: 'Listing title',
  })
  title: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Cocoa', description: 'Commodity name' })
  commodity: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Ghana', description: 'Country of origin' })
  country: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Ashanti', description: 'Region or state' })
  region?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'High quality fermented beans from smallholder farms.',
    description: 'Short listing summary',
  })
  short_description?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'A farmer-led cooperative...',
    description: 'Long-form story and impact description',
  })
  long_description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'quantity must be at least 1' })
  @ApiProperty({
    example: 1000,
    minimum: 1,
    description: 'Quantity of commodity',
  })
  quantity: number;

  @IsString()
  @IsIn(['kg', 'tons'])
  @ApiProperty({
    enum: ['kg', 'tons'],
    example: 'kg',
    description: 'Unit of measurement',
  })
  quantity_unit: 'kg' | 'tons';

  @Type(() => Number)
  @IsNumber()
  @Min(100, { message: 'total_value must be at least 100' })
  @ApiProperty({
    example: 50000,
    minimum: 100,
    description: 'Total deal value in USD',
  })
  total_value: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @ApiPropertyOptional({
    example: 24.5,
    description: 'Expected annual ROI percentage',
  })
  expected_roi?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @ApiPropertyOptional({
    example: 180,
    description: 'Expected duration in days',
  })
  duration_days?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @ApiPropertyOptional({
    example: 250,
    description: 'Minimum investment lot',
  })
  min_investment_lot?: number;

  @IsOptional()
  @IsIn(['Low', 'Medium', 'High'])
  @ApiPropertyOptional({
    enum: ['Low', 'Medium', 'High'],
    description: 'Risk rating',
  })
  risk_rating?: 'Low' | 'Medium' | 'High';

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'Opposite Kuto market, Abeokuta',
    description: 'Farm location text',
  })
  farm_location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @ApiPropertyOptional({ example: 7.123456, description: 'Farm latitude' })
  farm_latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @ApiPropertyOptional({ example: 3.123456, description: 'Farm longitude' })
  farm_longitude?: number;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ description: 'Farm photo metadata entries' })
  farm_photos?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ description: 'Supporting document metadata entries' })
  supporting_documents?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ description: 'Shipment milestone plan template' })
  logistics_plan?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description:
      'Farmer user UUID (traders must supply this; farmers default to themselves)',
  })
  farmer_id: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Trader user UUID (optional for farmer self-listing)',
  })
  trader_id?: string;

  @IsDateString()
  @MinDate(new Date(), { message: 'delivery_date must be in the future' })
  @ApiProperty({
    example: '2024-06-15',
    description: 'Expected delivery date (must be in the future)',
  })
  delivery_date: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({
    example: 50,
    minimum: 0,
    description: 'Minimum investment lot size in USD (#835, default 1)',
  })
  min_lot_size?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    description:
      'Investment increment above the minimum in USD (#835, default 1)',
  })
  lot_step?: number;
}
