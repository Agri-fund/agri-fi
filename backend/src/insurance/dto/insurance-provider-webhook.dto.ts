import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class InsuranceProviderWebhookDto {
  @ApiProperty()
  @IsUUID()
  claimId: string;

  @ApiProperty()
  @IsString()
  providerClaimId: string;

  @ApiProperty({ enum: ['approved', 'rejected', 'paid'] })
  @IsIn(['approved', 'rejected', 'paid'])
  status: 'approved' | 'rejected' | 'paid';

  @ApiPropertyOptional({ minimum: 0.01 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  approvedAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payoutId?: string;

  @ApiPropertyOptional({ minimum: 0.01 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  payoutAmount?: number;
}
