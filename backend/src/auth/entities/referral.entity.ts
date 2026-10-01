import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';

export type ReferralStatus = 'clicked' | 'registered' | 'rewarded';
export type ReferralPayoutStatus = 'pending' | 'accrued' | 'paid' | 'failed';

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Referral ID' })
  id: string;

  @Column({ name: 'referrer_id' })
  referrerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referrer_id' })
  referrer: User;

  @Column({ name: 'referee_id', nullable: true })
  refereeId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'referee_id' })
  referee: User | null;

  @Column({ type: 'varchar', default: 'clicked' })
  @ApiProperty({
    description: 'Referral status',
    enum: ['clicked', 'registered', 'rewarded'],
    example: 'registered',
  })
  status: ReferralStatus;

  @Column({
    name: 'reward_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  @ApiProperty({ description: 'Reward amount credited', example: 5.0 })
  rewardAmount: number;

  /** Acquisition channel for funnel analytics (#1018). */
  @Column({ type: 'varchar', length: 64, default: 'unknown' })
  @ApiProperty({
    description: 'Referral acquisition channel',
    example: 'email',
  })
  channel: string;

  /** Reward payout lifecycle (#1018). */
  @Column({
    name: 'payout_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  @ApiProperty({
    description: 'Reward payout status',
    enum: ['pending', 'accrued', 'paid', 'failed'],
    example: 'accrued',
  })
  payoutStatus: ReferralPayoutStatus;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({ description: 'Referral creation timestamp' })
  createdAt: Date;
}
