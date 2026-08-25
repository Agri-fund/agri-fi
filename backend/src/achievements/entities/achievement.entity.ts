import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export type BadgeType =
  | 'first_investment'
  | 'diversified'
  | 'early_bird'
  | 'long_term'
  | 'impact_farmer'
  | 'community';

@Entity('achievements')
@Unique(['userId', 'badgeType'])
export class Achievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'badge_type', type: 'varchar', length: 64 })
  badgeType: BadgeType;

  @Column({ name: 'earned_at', type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  earnedAt: Date;

  @Column({ name: 'granted_by', type: 'varchar', length: 64, nullable: true })
  grantedBy: string | null;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
