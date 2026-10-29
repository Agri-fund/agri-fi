import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AmlPatternType, AmlRuleAction, AmlSeverity } from '../aml.constants';

/**
 * Tunable parameters a monitoring rule feeds its detector. Kept as jsonb so a
 * new pattern can be introduced without a schema change; `aml.constants.ts`
 * documents which keys each `patternType` reads.
 */
export interface AmlRuleParameters {
  /** Flows at or below this amount still count toward a structuring bucket. */
  maxIndividualAmountUsd?: number;
  /** Aggregate amount that turns a bucket of sub-threshold flows into an alert. */
  aggregateThresholdUsd?: number;
  /** Number of flows required before the pattern fires. */
  minFlowCount?: number;
  /** Outflow as a fraction of inflow that counts as pass-through movement. */
  movementRatio?: number;
  /** Distinct deals touched before funds leave, for layering detection. */
  minDistinctDeals?: number;
  /** Absolute ceiling on flows inside the window (velocity rule). */
  maxFlowsPerWindow?: number;
  /** ISO-3166 alpha-2 codes treated as high risk for the jurisdiction rule. */
  countries?: string[];
  /** Single-flow threshold for HIGH_VALUE. */
  amountThresholdUsd?: number;
  /** Std-dev deviations from a user's own baseline that count as anomalous. */
  zScoreThreshold?: number;
  /** Minimum history rows before behavioural baselines are trusted. */
  minHistorySamples?: number;
  /** Movements at the tail of the series scored against the rest, for behavioural rules. */
  recentCount?: number;
  /** Smallest inflow that can count as pass-through movement. */
  minInflowUsd?: number;
}

/**
 * Configurable monitoring rule (#1217). Deliberately separate from
 * `RegulatoryRule`: the regulatory engine screens a *single* fact set against
 * static conditions, while these rules need a rolling time window over many
 * money movements. The two are complementary — a raised alert is still pushed
 * through `RegulatoryRuleEngineService.screenTransaction()` for jurisdiction
 * policy.
 */
@Entity('aml_monitoring_rules')
@Unique(['ruleCode'])
@Index(['patternType', 'enabled'])
@Index(['riskLevel', 'enabled'])
export class AmlMonitoringRule {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'AML-MON-STRUCT-001' })
  @Column({ name: 'rule_code', length: 64 })
  ruleCode: string;

  @ApiProperty()
  @Column({ length: 160 })
  name: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', default: '' })
  description: string;

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

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @Column({ name: 'risk_level', length: 16, default: 'MEDIUM' })
  riskLevel: AmlSeverity;

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

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @ApiProperty({ example: 'GLOBAL', required: false })
  @Column({ length: 16, default: 'GLOBAL' })
  jurisdiction: string;

  @ApiProperty({ description: 'Rolling window the detector looks back over' })
  @Column({ name: 'window_hours', type: 'int', default: 24 })
  windowHours: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  parameters: AmlRuleParameters;

  @ApiProperty({
    description: '0-100 risk score contributed when the pattern fires',
  })
  @Column({
    name: 'base_risk_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 50,
  })
  baseRiskScore: number;

  @ApiProperty({
    description: 'Alerts below this effective score stay in the run log only',
  })
  @Column({
    name: 'alert_threshold_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 40,
  })
  alertThresholdScore: number;

  @ApiProperty({
    description: 'Multiplier from false-positive feedback (<1 quiets the rule)',
  })
  @Column({
    name: 'sensitivity_multiplier',
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 1,
  })
  sensitivityMultiplier: number;

  @ApiProperty()
  @Column({ name: 'false_positive_count', type: 'int', default: 0 })
  falsePositiveCount: number;

  @ApiProperty()
  @Column({ name: 'true_positive_count', type: 'int', default: 0 })
  truePositiveCount: number;

  @ApiProperty()
  @Column({ type: 'int', default: 1 })
  version: number;

  @ApiProperty()
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
