import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AmlCaseStatus, AmlDisposition, AmlSeverity } from '../aml.constants';

export interface AmlCaseTimelineEntry {
  at: string;
  actorId: string | null;
  action: string;
  detail: Record<string, unknown>;
}

/**
 * Investigation case for flagged transactions (#1217). Alerts attach to a case;
 * a case is what an analyst works, closes and (optionally) files a SAR from.
 */
@Entity('aml_cases')
@Unique(['caseNumber'])
@Index(['status', 'priority'])
@Index(['assignedTo', 'status'])
export class AmlCase {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'AML-CASE-2026-000123' })
  @Column({ name: 'case_number', length: 40 })
  caseNumber: string;

  @ApiProperty()
  @Column({ length: 255 })
  title: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', default: '' })
  summary: string;

  @ApiProperty()
  @Column({ name: 'subject_user_id', type: 'uuid', nullable: true })
  subjectUserId: string | null;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @Column({ length: 16, default: 'MEDIUM' })
  priority: AmlSeverity;

  @ApiProperty({
    enum: ['open', 'in_review', 'escalated', 'awaiting_information', 'closed'],
  })
  @Column({ length: 32, default: 'open' })
  status: AmlCaseStatus;

  @ApiProperty()
  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo: string | null;

  @ApiProperty()
  @Column({ name: 'opened_by', type: 'uuid', nullable: true })
  openedBy: string | null;

  @ApiProperty({ type: 'array', items: { type: 'string' } })
  @Column({ name: 'alert_ids', type: 'jsonb', default: () => "'[]'" })
  alertIds: string[];

  @ApiProperty({
    description: 'Highest effective risk score across linked alerts',
  })
  @Column({
    name: 'risk_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  riskScore: number;

  @ApiProperty()
  @Column({
    name: 'exposure_usd',
    type: 'decimal',
    precision: 36,
    scale: 7,
    default: 0,
  })
  exposureUsd: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ name: 'subject_snapshot', type: 'jsonb', default: () => "'{}'" })
  subjectSnapshot: Record<string, unknown>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => "'[]'" })
  timeline: AmlCaseTimelineEntry[];

  @ApiProperty({
    enum: [
      'false_positive',
      'sar_filed',
      'no_action',
      'referred_to_authority',
      'account_restricted',
    ],
    required: false,
  })
  @Column({ length: 32, nullable: true, default: null })
  disposition: AmlDisposition | null;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true, default: null })
  notes: string | null;

  @ApiProperty({ description: 'Analyst SLA deadline derived from priority' })
  @Column({
    name: 'due_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  dueAt: Date | null;

  @ApiProperty()
  @Column({
    name: 'closed_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
