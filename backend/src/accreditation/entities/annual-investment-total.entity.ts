import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

/**
 * Tracks the total USD invested by an investor in a given calendar year.
 * Used to enforce annual investment caps per accreditation tier (#902).
 * Reset to 0 on Jan 1 via cron job.
 */
@Entity('annual_investment_totals')
@Unique(['investorId', 'year'])
@Index(['investorId', 'year'])
export class AnnualInvestmentTotal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'investor_id' })
  investor: User;

  @Column({ name: 'investor_id' })
  @ApiProperty({ description: 'Investor user UUID' })
  investorId: string;

  @Column({ type: 'integer' })
  @ApiProperty({ description: 'Calendar year', example: 2026 })
  year: number;

  @Column({ name: 'total_usd', type: 'decimal', precision: 36, scale: 7, default: 0 })
  @ApiProperty({ description: 'Total amount invested this year in USD', example: '3500.00' })
  totalUsd: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
