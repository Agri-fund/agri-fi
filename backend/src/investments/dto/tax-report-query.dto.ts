import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TaxReportFormat {
  CSV = 'csv',
  PDF = 'pdf',
}

export class TaxReportQueryDto {
  @ApiProperty({ example: 2025, description: 'Financial year (YYYY)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;

  @ApiProperty({ enum: TaxReportFormat, default: TaxReportFormat.CSV })
  @IsEnum(TaxReportFormat)
  format: TaxReportFormat = TaxReportFormat.CSV;
}
