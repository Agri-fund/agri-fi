import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type UserRole = 'farmer' | 'trader' | 'investor' | 'admin';
export type KycStatus = 'pending' | 'verified' | 'rejected';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column()
  role: UserRole;

  @Column()
  country: string;

  @Column({ name: 'kyc_status', default: 'pending' })
  kycStatus: KycStatus;

  @Column({ name: 'wallet_address', unique: true, nullable: true })
  walletAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
