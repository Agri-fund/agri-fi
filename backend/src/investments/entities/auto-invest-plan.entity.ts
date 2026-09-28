import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

export type AutoInvestCadence = 'weekly' | 'biweekly' | 'monthly';
export type AutoInvestStatus = 'active' | 'paused' | 'cancelled';

/**
 * AutoInvestPlan — recurring dollar-cost-averaging plan for investors (#1001).
 *
 * The cron job evaluates plans whose `next_run_at` has elapsed, selects
 * open deals matching the plan's risk/type filters, and enqueues standard
 * `investment.fund` messages with idempotency keys.
 */
@Entity('auto_invest_plans')
export class AutoInvestPlan {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Plan UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'investor_id' })
  investor: User;

  @Column({ name: 'investor_id' })
  @ApiProperty({ description: 'Investor user UUID' })
  investorId: string;

  /**
   * Amount in USD to allocate per run (spread across selected deals).
   * Minimum $100 (one token).
   */
  @Column({ name: 'amount_usd', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({ description: 'Amount in USD to invest per allocation cycle', example: '500.00' })
  amountUsd: number;

  @Column({ type: 'varchar', length: 16 })
  @ApiProperty({ enum: ['weekly', 'biweekly', 'monthly'], description: 'Allocation cadence' })
  cadence: AutoInvestCadence;

  /**
   * Stellar wallet address used as the funding source.
   */
  @Column({ name: 'funding_wallet', type: 'varchar', length: 256 })
  @ApiProperty({ description: 'Stellar wallet address to fund investments from', example: 'GABCDEF...' })
  fundingWallet: string;

  /**
   * Maximum acceptable composite risk score (0–100). Deals above this
   * threshold are skipped. Defaults to 75 (i.e. excludes "Very High" risk).
   */
  @Column({ name: 'max_risk_score', type: 'decimal', precision: 5, scale: 2, default: 75 })
  @ApiProperty({ description: 'Maximum risk score for deal selection (0-100)', example: 75 })
  maxRiskScore: number;

  /**
   * Optional whitelist of commodity types (e.g. ["cocoa","coffee"]).
   * Null means all commodities are accepted.
   */
  @Column({ name: 'deal_type_filter', type: 'jsonb', nullable: true, default: null })
  @ApiPropertyOptional({ type: [String], description: 'Commodity whitelist. Null = any commodity', example: ['cocoa', 'coffee'] })
  dealTypeFilter: string[] | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  @ApiProperty({ enum: ['active', 'paused', 'cancelled'], description: 'Plan status' })
  status: AutoInvestStatus;

  /**
   * Maximum USD to deploy in a single calendar day across all plans for
   * this investor. Null = no additional cap (the per-run `amountUsd` applies).
   */
  @Column({ name: 'daily_cap_usd', type: 'decimal', precision: 36, scale: 7, nullable: true, default: null })
  @ApiPropertyOptional({ description: 'Maximum USD to allocate in any single day', example: '2000.00' })
  dailyCapUsd: number | null;

  /**
   * Consecutive failure counter. Plan auto-pauses after 3 consecutive failures.
   */
  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  @ApiProperty({ description: 'Count of consecutive allocation failures' })
  consecutiveFailures: number;

  /**
   * Timestamp when this plan should next be evaluated.
   * Updated after each successful (or skipped) run.
   */
  @Column({ name: 'next_run_at', type: 'timestamptz' })
  @ApiProperty({ description: 'Next scheduled allocation timestamp' })
  nextRunAt: Date;

  /**
   * Timestamp of the last successful allocation run.
   */
  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true, default: null })
  @ApiPropertyOptional({ description: 'Timestamp of last successful run' })
  lastRunAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
