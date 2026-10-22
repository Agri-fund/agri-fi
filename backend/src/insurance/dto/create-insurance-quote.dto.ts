import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { InsuranceCoverageType } from '../entities/insurance-quote.entity';

export class CreateInsuranceQuoteDto {
  @ApiProperty({
    enum: ['crop_failure', 'shipment_damage', 'price_fluctuation'],
  })
  @IsIn(['crop_failure', 'shipment_damage', 'price_fluctuation'])
  coverageType: InsuranceCoverageType;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  coveragePercent?: number;
}
