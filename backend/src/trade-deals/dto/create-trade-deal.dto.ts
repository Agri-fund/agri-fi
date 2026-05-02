import {
  IsDateString,
  IsIn,
  IsNotEmpty,
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
  @ApiProperty({ example: 'Cocoa', description: 'Commodity name' })
  commodity: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'quantity must be at least 1' })
  @ApiProperty({ example: 1000, minimum: 1, description: 'Quantity of commodity' })
  quantity: number;

  @IsString()
  @IsIn(['kg', 'tons'])
  @ApiProperty({ enum: ['kg', 'tons'], example: 'kg', description: 'Unit of measurement' })
  quantity_unit: 'kg' | 'tons';

  @Type(() => Number)
  @IsNumber()
  @Min(100, { message: 'total_value must be at least 100' })
  @ApiProperty({ example: 50000, minimum: 100, description: 'Total deal value in USD' })
  total_value: number;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Farmer user UUID (traders must supply this; farmers default to themselves)' })
  farmer_id: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Trader user UUID (optional for farmer self-listing)' })
  trader_id?: string;

  @IsDateString()
  @MinDate(new Date(), { message: 'delivery_date must be in the future' })
  @ApiProperty({ example: '2024-06-15', description: 'Expected delivery date (must be in the future)' })
  delivery_date: string;
}
