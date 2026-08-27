import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from './trade-deal.entity';

export type DealCoFarmerStatus = 'invited' | 'accepted' | 'declined' | 'removed';

/**
 * Join table linking a trade deal to co-farmer users (#891).
 *
 * Each co-farmer is responsible for a defined portion% of the delivery and
 * receives the matching portion of the net returns at distribution time.
 */
@Entity('deal_co_farmers')
@Unique('UQ_deal_co_farmer', ['tradeDealId', 'farmerId'])
@Index(['farmerId'])
export class DealCoFarmer {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique co-farmer record identifier (UUID)' })
  id: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'trade_deal_id' })
  @ApiProperty({ description: 'Associated trade deal UUID' })
  tradeDealId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmer_id' })
  farmer: User;

  @Column({ name: 'farmer_id' })
  @ApiProperty({ description: 'Co-farmer user UUID' })
  farmerId: string;

  @Column({ name: 'portion_percent', type: 'decimal', precision: 5, scale: 2 })
  @ApiProperty({
    description:
      'Share of the delivery and net payout this co-farmer is responsible for (0-100)',
    example: 25.5,
  })
  portionPercent: number;

  @Column({ type: 'text', default: 'invited' })
  @ApiProperty({
    description: 'Invitation status',
    enum: ['invited', 'accepted', 'declined', 'removed'],
    example: 'invited',
  })
  status: DealCoFarmerStatus;

  /** Email address the invitation was sent to (before user account link). */
  @Column({ nullable: true })
  @ApiProperty({ description: 'Email the invitation was sent to', required: false })
  invitedEmail: string | null;

  @Exclude()
  @Column({ name: 'invitation_token', nullable: true })
  invitationToken: string | null;

  @Exclude()
  @Column({ name: 'invitation_expires_at', type: 'timestamptz', nullable: true })
  invitationExpiresAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'declined_at', type: 'timestamptz', nullable: true })
  declinedAt: Date | null;

  @Column({ name: 'invited_by' })
  @ApiProperty({ description: 'User who sent the invitation (lead farmer or trader)' })
  invitedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
