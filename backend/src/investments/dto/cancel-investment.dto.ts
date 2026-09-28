import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelInvestmentDto {
  @ApiPropertyOptional({
    description: 'Optional investor-supplied reason, recorded on the audit trail',
    example: 'Changed my mind about this deal',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
