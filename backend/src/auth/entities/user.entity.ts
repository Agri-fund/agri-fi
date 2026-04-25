import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type UserRole =
  | 'farmer'
  | 'trader'
  | 'investor'
  | 'company_admin'
  | 'admin';
export type KycStatus = 'pending' | 'verified' | 'rejected';

export interface CompanyDetails {
  companyName?: string;
  registrationNumber?: string;
  articlesOfIncorporationUrl?: string;
}

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

  @Column({ name: 'token_version', default: 0 })
  tokenVersion: number;

  @Column({ name: 'wallet_address', unique: true, nullable: true })
  walletAddress: string | null;

  @Column({ name: 'is_company', default: false })
  isCompany: boolean;

  @Column({
    name: 'company_details',
    type: 'simple-json',
    nullable: true,
  })
  companyDetails: CompanyDetails | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
