import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('login_logs')
@Index(['userId'])
@Index(['deviceFingerprint'])
@Index(['countryCode'])
export class LoginLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'ip_address' })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text' })
  userAgent: string;

  @Column({ nullable: true })
  country: string | null;

  @Column({ nullable: true })
  city: string | null;

  @Column({ name: 'device_fingerprint', nullable: true, type: 'text' })
  deviceFingerprint: string | null;

  @Column({ name: 'country_code', nullable: true, length: 2 })
  countryCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
