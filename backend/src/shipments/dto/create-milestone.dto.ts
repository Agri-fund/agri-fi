import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MilestoneType } from '../entities/shipment-milestone.entity';

export class MilestoneLocationDto {
  @ApiProperty({ example: 5.6037, description: 'Latitude' })
  @IsNumber()
  lat: number;

  @ApiProperty({ example: -0.187, description: 'Longitude' })
  @IsNumber()
  lng: number;
}

export class CreateMilestoneDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the associated trade deal',
  })
  @IsUUID()
  trade_deal_id: string;

  @ApiProperty({
    enum: ['farm', 'warehouse', 'port', 'importer'],
    example: 'warehouse',
    description:
      'Shipment stage. Must follow sequence: farm → warehouse → port → importer',
  })
  @IsIn(['farm', 'warehouse', 'port', 'importer'])
  milestone: MilestoneType;

  @ApiPropertyOptional({
    example: 'Arrived at Tema port, awaiting customs clearance',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  /** @deprecated Use location.lat instead. Kept for backward compatibility. */
  @ApiPropertyOptional({ example: 5.6037, description: 'Optional latitude (legacy, prefer location.lat)' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  /** @deprecated Use location.lng instead. Kept for backward compatibility. */
  @ApiPropertyOptional({ example: -0.187, description: 'Optional longitude (legacy, prefer location.lng)' })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({
    type: MilestoneLocationDto,
    description: 'Geolocation captured from the trader\'s device',
    example: { lat: 5.6037, lng: -0.187 },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MilestoneLocationDto)
  location?: MilestoneLocationDto;

  @ApiPropertyOptional({
    type: [String],
    description: 'Array of document UUIDs (POE-anchored photos) attached as evidence',
    example: ['doc-uuid-1', 'doc-uuid-2'],
    maxItems: 10,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  evidence?: string[];
}
