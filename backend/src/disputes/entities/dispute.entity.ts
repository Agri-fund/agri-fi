import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { User } from '../../auth/entities/user.entity';

export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED_FARMER = 'RESOLVED_FARMER',
  RESOLVED_INVESTOR = 'RESOLVED_INVESTOR',
  ESCALATED = 'ESCALATED',
}

@Entity('disputes')
@Index(['dealId', 'status'])
@Index(['status', 'createdAt'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @Column({ name: 'deal_id', type: 'uuid' })
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  dealId: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_id' })
  deal: TradeDeal;

  @Column({ name: 'raised_by', type: 'uuid' })
  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  raisedBy: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'raised_by' })
  raiser: User;

  @Column({ type: 'text' })
  @ApiProperty({
    example:
      'Importer milestone not recorded within 14 days of expected delivery date.',
  })
  reason: string;

  @Column({
    name: 'evidence_urls',
    type: 'jsonb',
    default: () => "'[]'",
  })
  @ApiProperty({
    type: [String],
    example: ['https://ipfs.io/ipfs/QmExampleEvidence'],
  })
  evidenceUrls: string[];

  @Column({
    type: 'varchar',
    length: 32,
    default: DisputeStatus.OPEN,
  })
  @ApiProperty({
    enum: DisputeStatus,
    example: DisputeStatus.OPEN,
  })
  status: DisputeStatus;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  resolutionNotes: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  escalatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty()
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @ApiProperty()
  updatedAt: Date;
}
