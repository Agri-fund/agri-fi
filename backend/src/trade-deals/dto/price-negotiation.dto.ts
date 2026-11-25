import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PriceNegotiationStatus } from '../entities/price-negotiation.entity';

export class CreateNegotiationDto {
  @ApiProperty({
    description: 'Proposed price / deal total value in USD',
    example: 48500.0,
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  proposed_price: number;

  @ApiPropertyOptional({
    description: 'Optional note or rationale for the price proposal',
    example: 'Adjusting price to reflect premium grade coffee certification.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class UpdateNegotiationDto {
  @ApiPropertyOptional({
    description: 'Target negotiation status (ACCEPTED or REJECTED)',
    enum: [PriceNegotiationStatus.ACCEPTED, PriceNegotiationStatus.REJECTED],
    example: PriceNegotiationStatus.ACCEPTED,
  })
  @IsOptional()
  @IsEnum([PriceNegotiationStatus.ACCEPTED, PriceNegotiationStatus.REJECTED], {
    message: 'status must be either ACCEPTED or REJECTED',
  })
  status?: PriceNegotiationStatus;

  @ApiPropertyOptional({
    description: 'Action verb as alternative to status (accept or reject)',
    example: 'accept',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'Optional response note',
    example: 'Accepted counter-offer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
