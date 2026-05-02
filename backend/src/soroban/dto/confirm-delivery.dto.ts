import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmDeliveryDto {
  @ApiProperty({ description: 'Marketplace order ID', example: 'order-uuid-here' })
  @IsString()
  @IsNotEmpty()
  orderId: string;
}
