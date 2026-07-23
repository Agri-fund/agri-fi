import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsIn, IsOptional, IsString, IsNumber } from 'class-validator';
import { MilestoneType } from '../entities/shipment-milestone.entity';

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

  @ApiPropertyOptional({ example: 5.6037, description: 'Optional latitude' })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: -0.187, description: 'Optional longitude' })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}
