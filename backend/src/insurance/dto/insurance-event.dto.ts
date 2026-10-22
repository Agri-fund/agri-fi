import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsUUID, Min } from 'class-validator';

export class InsuranceEventDto {
  @ApiProperty()
  @IsUUID()
  dealId: string;

  @ApiProperty({ description: 'Stable idempotency key from the event source' })
  @IsUUID()
  eventId: string;

  @ApiProperty({
    enum: ['crop_failure', 'shipment_damage', 'price_fluctuation'],
  })
  @IsIn(['crop_failure', 'shipment_damage', 'price_fluctuation'])
  eventType: 'crop_failure' | 'shipment_damage' | 'price_fluctuation';

  @ApiProperty({ minimum: 0.01, description: 'Verified loss amount in USD' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  lossAmount: number;

  @ApiProperty({ description: 'UTC occurrence time of the covered event' })
  @IsISO8601()
  occurredAt: string;
}
