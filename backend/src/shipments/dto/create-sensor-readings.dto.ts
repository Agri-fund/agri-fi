import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';

export enum SensorTypeEnum {
  TEMPERATURE = 'TEMPERATURE',
  HUMIDITY = 'HUMIDITY',
  CO2 = 'CO2',
  VIBRATION = 'VIBRATION',
}

export class SensorReadingItemDto {
  @ApiProperty({ enum: SensorTypeEnum })
  @IsEnum(SensorTypeEnum)
  sensorType: SensorTypeEnum;

  @ApiProperty({ example: 4.5 })
  @IsNumber()
  value: number;

  @ApiProperty({ example: '°C' })
  @IsString()
  @MaxLength(20)
  unit: string;

  @ApiProperty({ example: 'device-001' })
  @IsString()
  @MaxLength(128)
  deviceId: string;

  @ApiProperty({ example: '2026-08-26T10:00:00Z' })
  @IsDateString()
  recordedAt: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  milestoneId?: string;
}

export class CreateSensorReadingsDto {
  @ApiProperty({ type: [SensorReadingItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SensorReadingItemDto)
  readings: SensorReadingItemDto[];
}
