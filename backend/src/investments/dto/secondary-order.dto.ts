import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SecondaryOrderSide,
  SecondaryOrderType,
  StopLossDirection,
} from '../entities/secondary-order.entity';

export class CreateSecondaryOrderDto {
  @ApiProperty({
    example: 'FARM001',
    description: 'Token code to trade',
  })
  @IsString()
  @IsNotEmpty()
  tokenCode: string;

  @ApiProperty({
    example: SecondaryOrderSide.SELL,
    enum: SecondaryOrderSide,
    description: 'buy or sell',
  })
  @IsEnum(SecondaryOrderSide)
  side: SecondaryOrderSide;

  @ApiProperty({
    example: SecondaryOrderType.LIMIT,
    enum: SecondaryOrderType,
    description:
      'limit rests on the book and may fill partially; ' +
      'fok is all-or-nothing; ' +
      'stop_loss arms once the market price crosses triggerPrice',
  })
  @IsEnum(SecondaryOrderType)
  type: SecondaryOrderType;

  @ApiProperty({
    example: 100,
    minimum: 0,
    description: 'Number of tokens to trade',
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  tokenAmount: number;

  @ApiProperty({
    example: 10.5,
    description: 'Limit price per token in USD',
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  pricePerToken: number;

  @ApiProperty({
    required: false,
    example: 9,
    description: 'Required when type is stop_loss. Ignored otherwise.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  triggerPrice?: number;

  @ApiProperty({
    required: false,
    enum: StopLossDirection,
    description:
      'Required when type is stop_loss. ' +
      '"below" arms a sell stop (triggers when marketPrice <= triggerPrice); ' +
      '"above" arms a buy stop (triggers when marketPrice >= triggerPrice). ' +
      'Defaults to "below" for sell orders and "above" for buy orders.',
  })
  @IsOptional()
  @IsEnum(StopLossDirection)
  stopDirection?: StopLossDirection;

  @ApiProperty({
    required: false,
    example: '2024-01-15T10:30:00Z',
    description:
      'Optional expiry; matching ignores the order past this instant',
  })
  @IsOptional()
  @Type(() => Date)
  expiresAt?: Date;
}

export class CancelSecondaryOrderDto {
  @ApiProperty({
    required: false,
    example: 'user_requested',
    description: 'Free-form cancellation reason recorded on the order',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class OrderBookQueryDto {
  @ApiProperty({
    example: 'FARM001',
    description: 'Token code to read the book for',
  })
  @IsString()
  @IsNotEmpty()
  tokenCode: string;

  @ApiProperty({
    required: false,
    example: 20,
    minimum: 1,
    description: 'Depth per side',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  depth?: number;
}
