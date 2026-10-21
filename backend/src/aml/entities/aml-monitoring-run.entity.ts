import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AmlRunStatus } from '../aml.constants';

/**
 * Bookkeeping for one monitoring sweep (#1217). Storing the window makes a
 * crashed sweep re-runnable and gives compliance a coverage record ("was every
 * transaction in October monitored?").
 */
@Entity('aml_monitoring_runs')
@Index(['status', 'createdAt'])
export class AmlMonitoringRun {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'manual | cron' })
  @Column({ name: 'trigger_type', length: 16, default: 'cron' })
  triggerType: string;

  @ApiProperty()
  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart: Date;

  @ApiProperty()
  @Column({ name: 'window_end', type: 'timestamptz' })
  windowEnd: Date;

  @ApiProperty({ enum: ['running', 'completed', 'failed', 'skipped'] })
  @Column({ length: 16, default: 'running' })
  status: AmlRunStatus;

  @ApiProperty()
  @Column({ name: 'users_evaluated', type: 'int', default: 0 })
  usersEvaluated: number;

  @ApiProperty()
  @Column({ name: 'flows_evaluated', type: 'int', default: 0 })
  flowsEvaluated: number;

  @ApiProperty()
  @Column({ name: 'rules_applied', type: 'int', default: 0 })
  rulesApplied: number;

  @ApiProperty()
  @Column({ name: 'alerts_raised', type: 'int', default: 0 })
  alertsRaised: number;

  @ApiProperty()
  @Column({ name: 'cases_opened', type: 'int', default: 0 })
  casesOpened: number;

  @ApiProperty({ description: 'Wall-clock duration in milliseconds' })
  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @ApiProperty()
  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
    default: null,
  })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({
    name: 'finished_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  finishedAt: Date | null;
}
