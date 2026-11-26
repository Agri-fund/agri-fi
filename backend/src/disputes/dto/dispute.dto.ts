import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DisputeStatus } from '../entities/dispute.entity';

export class CreateDisputeDto {
  @ApiPropertyOptional({
    description: 'Trade deal UUID (snake_case alias)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  deal_id?: string;

  @ApiPropertyOptional({
    description: 'Trade deal UUID (camelCase alias)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  dealId?: string;

  @ApiProperty({
    description: 'Reason for raising the escrow dispute',
    example: 'Shipment not delivered 14 days past expected delivery date.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional initial evidence URLs',
    example: ['https://ipfs.io/ipfs/QmEvidence1'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence_urls?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional initial evidence URLs (camelCase alias)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}

export class ResolveDisputeDto {
  @ApiProperty({
    enum: ['release_farmer', 'refund_investors'],
    description:
      'Admin resolution decision: release escrow to farmer or refund investors',
    example: 'release_farmer',
  })
  @IsIn(['release_farmer', 'refund_investors'])
  resolution: 'release_farmer' | 'refund_investors';

  @ApiPropertyOptional({
    description: 'Optional admin resolution notes',
    example: 'Verified customs clearance and importer confirmation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DisputeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  deal_id: string;

  @ApiProperty()
  raised_by: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: [String] })
  evidence_urls: string[];

  @ApiProperty({ enum: DisputeStatus })
  status: DisputeStatus;

  @ApiPropertyOptional({ nullable: true })
  reviewed_by: string | null;

  @ApiPropertyOptional({ nullable: true })
  resolution_notes: string | null;

  @ApiPropertyOptional({ nullable: true })
  resolved_at: Date | null;

  @ApiPropertyOptional({ nullable: true })
  escalated_at: Date | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}
