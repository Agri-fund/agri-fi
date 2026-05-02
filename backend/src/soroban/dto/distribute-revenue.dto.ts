import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DistributeRevenueDto {
  @ApiProperty({
    description: 'Revenue amount in USDC stroops (1 USDC = 10_000_000)',
    example: '500000000000',
  })
  @IsString()
  @IsNotEmpty()
  revenueAmountStroops: string;
}
