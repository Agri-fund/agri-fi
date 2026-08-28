import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { encryptionTransformer } from '../../common/encryption.transformer';

export type UserRole =
  | 'farmer'
  | 'trader'
  | 'investor'
  | 'company_admin'
  | 'admin';
export type KycStatus = 'pending' | 'verified' | 'rejected' | 'expired';

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

  @Column({ name: 'google_subject', unique: true, nullable: true })
  googleSubject: string | null;

  @Exclude()
  @Column({ name: 'password_hash' })
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
    enum: ['pending', 'verified', 'rejected', 'expired'],
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

  // #409 — email verification
  @Column({ name: 'is_email_verified', default: false })
  @ApiProperty({
    description: 'Whether the email address has been verified',
    example: false,
  })
  isEmailVerified: boolean;

  @Exclude()
  @Column({ name: 'email_verification_token', nullable: true })
  emailVerificationToken: string | null;

  // #413 — account lockout
  @Column({ name: 'failed_login_attempts', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'lockout_until', type: 'timestamptz', nullable: true })
  lockoutUntil: Date | null;

  // #652 — MFA support
  @Exclude()
  @Column({ name: 'mfa_secret', nullable: true })
  mfaSecret: string | null;

  @Column({ name: 'is_mfa_enabled', default: false })
  @ApiProperty({
    description: 'Whether MFA is enabled for this user',
    example: false,
  })
  isMfaEnabled: boolean;

  // #827 — MFA backup codes (bcrypt-hashed, single-use)
  @Exclude()
  @Column({ name: 'mfa_backup_codes', type: 'simple-json', nullable: true })
  mfaBackupCodes: string[] | null;

  // #827 — MFA failed attempt tracking
  @Column({ name: 'mfa_failed_attempts', default: 0 })
  mfaFailedAttempts: number;

  @Column({ name: 'mfa_locked_until', type: 'timestamptz', nullable: true })
  mfaLockedUntil: Date | null;

  // #806 — admin MFA enforcement: flagged when admin/company_admin has no MFA set up
  @Column({ name: 'mfa_enrollment_required', default: false })
  @ApiProperty({
    description: 'Whether this admin account must complete MFA enrollment before accessing the platform',
    example: false,
  })
  mfaEnrollmentRequired: boolean;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  /** Full legal name — stored AES-256-CBC encrypted */
  @Exclude()
  @Column({
    name: 'full_name',
    nullable: true,
    transformer: encryptionTransformer,
  })
  fullName: string | null;

  /** Date of birth — stored AES-256-CBC encrypted (ISO date string) */
  @Exclude()
  @Column({
    name: 'birthdate',
    nullable: true,
    transformer: encryptionTransformer,
  })
  birthdate: string | null;

  /** Tax / national ID number — stored AES-256-CBC encrypted */
  @Exclude()
  @Column({
    name: 'tax_id',
    nullable: true,
    transformer: encryptionTransformer,
  })
  taxId: string | null;

  /** Phone number — stored AES-256-GCM encrypted */
  @Exclude()
  @Column({ name: 'phone', nullable: true, transformer: encryptionTransformer })
  phone: string | null;

  /** Physical / mailing address — stored AES-256-GCM encrypted */
  @Exclude()
  @Column({
    name: 'physical_address',
    nullable: true,
    transformer: encryptionTransformer,
  })
  physicalAddress: string | null;

  /** Farmer credit score (300-850) based on historical performance */
  @Column({ name: 'credit_score', type: 'int', nullable: true })
  @ApiProperty({
    description:
      'Farmer credit score calculated from historical performance (300-850)',
    nullable: true,
    example: 720,
  })
  creditScore: number | null;

  /** Preferred language for transactional emails (#897). ISO 639-1 code. */
  @Column({ name: 'preferred_language', type: 'varchar', length: 8, default: 'en' })
  @ApiProperty({
    description: 'Preferred language for emails and notifications',
    enum: ['en', 'es', 'fr', 'pt', 'sw'],
    example: 'en',
  })
  preferredLanguage: string;

  /** IANA timezone used for timezone-aware scheduling, e.g. weekly digests (#892). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  @ApiProperty({
    description: 'IANA timezone for scheduled notifications',
    example: 'Africa/Nairobi',
    required: false,
  })
  timezone: string | null;

  /**
   * Whether the user opted in to the weekly deal digest email (#892).
   * Toggled from notification preferences or the unsubscribe link.
   */
  @Column({ name: 'email_digest_enabled', type: 'boolean', default: true })
  @ApiProperty({
    description: 'Whether the weekly digest email is enabled',
    example: true,
  })
  emailDigestEnabled: boolean;

  /**
   * Set to true when the investor clicks the unsubscribe link in any drip
   * email. Stops further sequence steps from being dispatched (GDPR / CAN-SPAM).
   */
  @Column({ name: 'email_sequence_unsubscribed', type: 'boolean', default: false })
  @ApiProperty({
    description: 'Whether the user has unsubscribed from the onboarding email sequence',
    example: false,
  })
  emailSequenceUnsubscribed: boolean;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'gdpr_erasure_requested_at', type: 'timestamptz', nullable: true })
  gdprErasureRequestedAt: Date | null;

  @Column({ name: 'gdpr_erasure_due_at', type: 'timestamptz', nullable: true })
  gdprErasureDueAt: Date | null;

  @Column({ name: 'gdpr_status', type: 'varchar', default: 'active' })
  gdprStatus: 'active' | 'pending_erasure' | 'erased';
}
