import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

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
  @ApiProperty({
    description: 'Unique user identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @Column({ unique: true })
  @ApiProperty({
    description: 'User email address (unique)',
    example: 'farmer@agri-fi.com',
  })
  email: string;

  @Column({ name: 'password_hash' })
  @ApiProperty({
    description: 'Hashed password (bcrypt)',
    example: '$2b$10$...',
  })
  passwordHash: string;

  @Column()
  @ApiProperty({
    description: 'User role',
    enum: ['farmer', 'trader', 'investor', 'company_admin', 'admin'],
    example: 'farmer',
  })
  role: UserRole;

  @Column()
  @ApiProperty({
    description: 'User country (ISO 3166-1 alpha-2)',
    example: 'KE',
  })
  country: string;

  @Column({ name: 'kyc_status', default: 'pending' })
  @ApiProperty({
    description: 'KYC verification status',
    enum: ['pending', 'verified', 'rejected'],
    example: 'verified',
  })
  kycStatus: KycStatus;

  @Column({ name: 'token_version', default: 0 })
  @ApiProperty({
    description: 'JWT token version for invalidation',
    example: 0,
  })
  tokenVersion: number;

  @Column({ name: 'wallet_address', unique: true, nullable: true })
  @ApiProperty({
    description: 'Stellar public key wallet address',
    nullable: true,
    example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  })
  walletAddress: string | null;

  @Column({ name: 'is_company', default: false })
  @ApiProperty({
    description: 'Whether this is a corporate account',
    example: false,
  })
  isCompany: boolean;

  @Column({
    name: 'company_details',
    type: 'simple-json',
    nullable: true,
  })
  @ApiProperty({
    description: 'Corporate account details',
    nullable: true,
    example: {
      companyName: 'Agri Corp Ltd',
      registrationNumber: 'REG123456',
      articlesOfIncorporationUrl: 'https://ipfs.io/ipfs/QmXxxx',
    },
  })
  companyDetails: CompanyDetails | null;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;
}
