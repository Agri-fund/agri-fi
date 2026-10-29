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
import {
  AmlAlertStatus,
  AmlPatternType,
  AmlRuleAction,
  AmlSeverity,
} from '../aml.constants';
import { AmlCase } from './aml-case.entity';
import { AmlMonitoringRule } from './aml-monitoring-rule.entity';

/**
 * Alert raised by the monitoring engine (#1217). `dedupeKey` makes sweeps
 * idempotent: re-running a window cannot raise the same finding twice.
 */
@Entity('aml_alerts')
@Unique(['dedupeKey'])
@Index(['userId', 'createdAt'])
@Index(['status', 'riskScore'])
@Index(['caseId'])
export class AmlAlert {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: [
      'STRUCTURING',
      'RAPID_MOVEMENT',
      'LAYERING',
      'VELOCITY',
      'HIGH_VALUE',
      'HIGH_RISK_JURISDICTION',
      'SANCTIONS_MATCH',
      'PEP_MATCH',
      'BEHAVIORAL_ANOMALY',
    ],
  })
  @Column({ name: 'pattern_type', length: 32 })
  patternType: AmlPatternType;

  @ApiProperty()
  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  @ManyToOne(() => AmlMonitoringRule, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  ruleId: string | null;

  @ApiProperty()
  @Column({ name: 'rule_code', length: 64 })
  ruleCode: string;

  @ApiProperty()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty()
  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId: string | null;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @Column({ length: 16, default: 'MEDIUM' })
  severity: AmlSeverity;

  @ApiProperty({
    enum: [
      'ALLOW',
      'FLAG_REVIEW',
      'REQUIRE_ENHANCED_DUE_DILIGENCE',
      'REJECT',
      'CAP_TRANSACTION',
    ],
  })
  @Column({ length: 40, default: 'FLAG_REVIEW' })
  action: AmlRuleAction;

  @ApiProperty({ description: '0-100, after false-positive tuning' })
  @Column({ name: 'risk_score', type: 'decimal', precision: 5, scale: 2 })
  riskScore: number;

  @ApiProperty({ description: 'USD value of the flows behind this alert' })
  @Column({
    name: 'amount_usd',
    type: 'decimal',
    precision: 36,
    scale: 7,
    nullable: true,
    default: null,
  })
  amountUsd: number | null;

  @ApiProperty()
  @Column({ length: 255 })
  title: string;

  @ApiProperty()
  @Column({ name: 'match_reason', type: 'text' })
  matchReason: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  evidence: Record<string, unknown>;

  @ApiProperty({
    enum: ['pending', 'triaged', 'escalated', 'false_positive', 'dismissed'],
  })
  @Column({ length: 24, default: 'pending' })
  status: AmlAlertStatus;

  @ApiProperty()
  @Column({ name: 'case_id', type: 'uuid', nullable: true })
  @ManyToOne(() => AmlCase, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'case_id' })
  caseId: string | null;

  @ApiProperty()
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId: string | null;

  @ApiProperty()
  @Column({ name: 'dedupe_key', length: 255 })
  dedupeKey: string;

  @ApiProperty()
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @ApiProperty()
  @Column({
    name: 'reviewed_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
