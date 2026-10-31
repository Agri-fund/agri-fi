import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InsuranceCoverageType } from '../entities/insurance-quote.entity';

export class CreateInsuranceClaimDto {
  @ApiProperty({ description: 'Stable idempotency key for the covered event' })
  @IsUUID()
  eventId: string;

  @ApiProperty({
    enum: ['crop_failure', 'shipment_damage', 'price_fluctuation'],
  })
  @IsIn(['crop_failure', 'shipment_damage', 'price_fluctuation'])
  eventType: InsuranceCoverageType;

  @ApiProperty({ minimum: 0.01, description: 'Documented loss amount in USD' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  evidence?: string[];
}
