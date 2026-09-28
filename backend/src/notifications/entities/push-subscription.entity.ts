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
import { User } from '../../auth/entities/user.entity';

export const SUPPORTED_PUSH_EVENT_TYPES = [
  'investment.confirmed',
  'escrow.released',
  'kyc.approved',
] as const;

export type PushEventType = (typeof SUPPORTED_PUSH_EVENT_TYPES)[number];

@Entity('push_subscriptions')
@Index(['userId', 'endpoint'], { unique: true })
export class PushSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  endpoint: string;

  @Column({ type: 'text', nullable: true })
  p256dh: string | null;

  @Column({ type: 'text', nullable: true })
  auth: string | null;

  @Column({
    name: 'event_types',
    type: 'text',
    array: true,
    default: () => "'{investment.confirmed,escrow.released,kyc.approved}'",
  })
  eventTypes: string[];

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
