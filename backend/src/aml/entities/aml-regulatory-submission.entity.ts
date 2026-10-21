import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { RegulatorySubmissionStatus } from '../aml.constants';

/**
 * Outbound regulatory filing record (#1217). Filings are recorded before the
 * transport is attempted so an unavailable authority endpoint never loses a
 * report, and each attempt is auditable.
 */
@Entity('aml_regulatory_submissions')
@Index(['reportType', 'status'])
@Index(['reportId', 'attempt'])
export class AmlRegulatorySubmission {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'SUB-2026-000017' })
  @Column({ name: 'submission_number', length: 40 })
  submissionNumber: string;

  @ApiProperty({ description: "'sar' | 'ctr' | 'periodic_report' | ..." })
  @Column({ name: 'report_type', length: 32 })
  reportType: string;

  @ApiProperty()
  @Column({ name: 'report_id', type: 'uuid' })
  reportId: string;

  @ApiProperty()
  @Column({ length: 64 })
  authority: string;

  @ApiProperty({
    description: 'Transport actually used: api | manual_secure_portal',
  })
  @Column({ length: 32, default: 'api' })
  channel: string;

  @ApiProperty({ enum: ['pending', 'accepted', 'rejected', 'failed'] })
  @Column({ length: 16, default: 'pending' })
  status: RegulatorySubmissionStatus;

  @ApiProperty()
  @Column({ type: 'int', default: 1 })
  attempt: number;

  @ApiProperty({
    description: 'Identifier returned by the authority, when accepted',
  })
  @Column({
    name: 'authority_reference',
    length: 120,
    nullable: true,
    default: null,
  })
  authorityReference: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ name: 'request_summary', type: 'jsonb', default: () => "'{}'" })
  requestSummary: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ name: 'response', type: 'jsonb', default: () => "'{}'" })
  response: Record<string, unknown>;

  @ApiProperty()
  @Column({
    name: 'submitted_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  submittedAt: Date | null;

  @ApiProperty()
  @Column({ name: 'submitted_by', type: 'uuid', nullable: true, default: null })
  submittedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
