import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';

export class PublicDealQueryDto {
  @ApiPropertyOptional({
    description: 'Number of results to return (max 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Zero-based offset for pagination',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Filter deals by agricultural commodity (e.g. Cocoa, Maize, Coffee)',
    example: 'Cocoa',
  })
  @IsOptional()
  @IsString()
  commodity?: string;

  @ApiPropertyOptional({
    description: 'Filter deals by status',
    enum: ['open', 'funded', 'delivered', 'completed'],
    example: 'open',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Search keyword across deal titles and descriptions',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
