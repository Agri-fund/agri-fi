import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { SarStatus } from '../aml.constants';
import { AmlCase } from './aml-case.entity';

/**
 * Suspicious Activity Report generated from an investigation case (#1217).
 * The narrative is assembled from the case's alerts so a filing is reproducible
 * from evidence, and `sha256_hash` pins the exact payload that was filed.
 */
@Entity('aml_sar_reports')
@Unique(['sarNumber'])
@Index(['status', 'filedAt'])
export class AmlSarReport {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'SAR-2026-000042' })
  @Column({ name: 'sar_number', length: 40 })
  sarNumber: string;

  @ApiProperty()
  @Column({ name: 'case_id', type: 'uuid' })
  @ManyToOne(() => AmlCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  caseId: string;

  @ApiProperty({
    description: 'Filing jurisdiction / regime the report targets',
  })
  @Column({ length: 32, default: 'US' })
  jurisdiction: string;

  @ApiProperty({
    description: 'Authority the report is filed with (FinCEN, CBN, NCA, ...)',
  })
  @Column({ length: 64, default: 'FinCEN' })
  authority: string;

  @ApiProperty()
  @Column({ name: 'filing_type', length: 32, default: 'initial' })
  filingType: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  subjects: Array<Record<string, unknown>>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  activities: Array<Record<string, unknown>>;

  @ApiProperty()
  @Column({
    name: 'suspicious_amount_usd',
    type: 'decimal',
    precision: 36,
    scale: 7,
    default: 0,
  })
  suspiciousAmountUsd: number;

  @ApiProperty()
  @Column({
    name: 'activity_from',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  activityFrom: Date | null;

  @ApiProperty()
  @Column({
    name: 'activity_to',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  activityTo: Date | null;

  @ApiProperty({
    description: 'Free-text narrative produced from case evidence',
  })
  @Column({ type: 'text', default: '' })
  narrative: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ name: 'structured_data', type: 'jsonb', default: () => "'{}'" })
  structuredData: Record<string, unknown>;

  @ApiProperty({ enum: ['draft', 'reviewed', 'submitted', 'acknowledged'] })
  @Column({ length: 20, default: 'draft' })
  status: SarStatus;

  @ApiProperty({ description: 'SHA-256 over the canonical JSON payload' })
  @Column({ name: 'sha256_hash', length: 64, default: '' })
  sha256Hash: string;

  @ApiProperty()
  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @ApiProperty()
  @Column({ name: 'generated_by', type: 'uuid', nullable: true, default: null })
  generatedBy: string | null;

  @ApiProperty()
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true, default: null })
  reviewedBy: string | null;

  @ApiProperty()
  @Column({
    name: 'reviewed_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  reviewedAt: Date | null;

  @ApiProperty()
  @Column({
    name: 'filed_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  filedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
