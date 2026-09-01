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
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

/**
 * Tracks each step of the investor onboarding email drip sequence.
 *
 * One row per (user, step) pair. The cron job reads rows where
 * scheduled_at <= NOW() and sent_at IS NULL to dispatch emails.
 *
 * Sequence steps (0-indexed, matching DRIP_STEPS in EmailSequenceService):
 *   0 – Day 0  Welcome (sent at registration)
 *   1 – Day 1  How it works
 *   2 – Day 3  Featured deal of the week
 *   3 – Day 5  Risk & returns explained
 *   4 – Day 7  Last chance
 */
@Entity('investor_email_sequences')
@Index('IDX_ies_user_scheduled', ['userId', 'scheduledAt'])
@Index('IDX_ies_pending', ['sentAt', 'scheduledAt'])
export class InvestorEmailSequence {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique row identifier',
    example: 'a1b2c3d4-...',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  @ApiProperty({ description: 'Investor user ID (FK → users.id)' })
  userId: string;

  /**
   * Zero-based index into the drip sequence.
   * 0 = Welcome, 1 = HowItWorks, 2 = FeaturedDeal, 3 = RiskReturns, 4 = LastChance
   */
  @Column({ name: 'sequence_step', type: 'smallint' })
  @ApiProperty({
    description: 'Step index in the drip sequence (0–4)',
    example: 2,
  })
  sequenceStep: number;

  /** When the email should be sent (registration time + day offset). */
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  @ApiProperty({
    description: 'Scheduled send timestamp',
    example: '2026-08-26T09:00:00Z',
  })
  scheduledAt: Date;

  /**
   * Set by the cron job once the email has been dispatched.
   * NULL means "not yet sent".
   */
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Timestamp when the email was actually sent; null if pending',
    nullable: true,
    example: '2026-08-26T09:00:12Z',
  })
  sentAt: Date | null;

  /**
   * NULL   – not yet determined (pending / sent OK)
   * string – SMTP / delivery error message (last attempt)
   */
  @Column({ name: 'error', type: 'text', nullable: true })
  @ApiProperty({
    description: 'Last delivery error message, if any',
    nullable: true,
    example: 'SMTP connection timeout',
  })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
