import { IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateTradeDealDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100, { message: 'total_value must be at least 100' })
  @ApiPropertyOptional({
    example: 50000,
    minimum: 100,
    description:
      'New total deal value in USD. Must be >= current total_invested (else 422 TOTAL_VALUE_BELOW_INVESTED).',
  })
  total_value?: number;
}
