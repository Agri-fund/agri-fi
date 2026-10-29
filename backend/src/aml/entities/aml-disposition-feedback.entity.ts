import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AmlDisposition } from '../aml.constants';

/**
 * Analyst feedback on a triaged alert (#1217). The dispositions recorded here
 * drive `sensitivityFromDisposition()`, which is how the engine learns to raise
 * fewer alerts from rules that keep turning out to be noise.
 */
@Entity('aml_disposition_feedback')
@Index(['ruleCode', 'createdAt'])
@Index(['alertId'])
export class AmlDispositionFeedback {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'alert_id', type: 'uuid', nullable: true, default: null })
  alertId: string | null;

  @ApiProperty()
  @Column({ name: 'case_id', type: 'uuid', nullable: true, default: null })
  caseId: string | null;

  @ApiProperty()
  @Column({ name: 'rule_code', length: 64 })
  ruleCode: string;

  @ApiProperty({
    enum: [
      'false_positive',
      'sar_filed',
      'no_action',
      'referred_to_authority',
      'account_restricted',
    ],
  })
  @Column({ length: 32 })
  disposition: AmlDisposition;

  @ApiProperty()
  @Column({ name: 'rule_id', type: 'uuid', nullable: true, default: null })
  ruleId: string | null;

  @ApiProperty()
  @Column({ name: 'pattern_type', length: 32, default: '' })
  patternType: string;

  @ApiProperty()
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true, default: null })
  recordedBy: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true, default: null })
  reason: string | null;

  @ApiProperty({
    description: 'Sensitivity multiplier the rule had when triaged',
  })
  @Column({
    name: 'sensitivity_before',
    type: 'decimal',
    precision: 4,
    scale: 2,
    nullable: true,
    default: null,
  })
  sensitivityBefore: number | null;

  @ApiProperty({
    description: 'Sensitivity multiplier recomputed after this entry',
  })
  @Column({
    name: 'sensitivity_after',
    type: 'decimal',
    precision: 4,
    scale: 2,
    nullable: true,
    default: null,
  })
  sensitivityAfter: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
