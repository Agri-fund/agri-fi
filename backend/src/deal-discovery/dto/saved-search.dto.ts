import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { DealFilters } from '../deal-filters';

export class CreateSavedSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Validated with `assertValidDealFilters` in the service. */
  @IsObject()
  filters: DealFilters;

  @IsBoolean()
  @IsOptional()
  notifyInApp?: boolean;

  @IsBoolean()
  @IsOptional()
  notifyEmail?: boolean;
}

export class RecordSearchDto {
  @IsObject()
  filters: DealFilters;

  @IsInt()
  @Min(0)
  @IsOptional()
  resultCount?: number;
}
