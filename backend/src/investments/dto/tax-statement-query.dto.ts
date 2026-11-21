import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TaxStatementQueryDto {
  @ApiPropertyOptional({
    example: 2024,
    description: 'Tax year (YYYY). Defaults to the current year.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;
}
