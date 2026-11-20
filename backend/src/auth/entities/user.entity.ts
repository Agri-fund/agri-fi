import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  VersionColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { encryptionTransformer } from '../../common/encryption.transformer';

export type UserRole =
  'farmer' | 'trader' | 'investor' | 'company_admin' | 'admin' | 'compliance_officer';
export type KycStatus = 'pending' | 'verified' | 'rejected' | 'expired';

// #902 — Investor accreditation tiers
export type AccreditationTier = 'retail' | 'accredited' | 'institutional';
export type AccreditationStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'expired';

/** Ordered tier values for comparison (higher index = higher tier). */
export const TIER_ORDER: AccreditationTier[] = ['retail', 'accredited', 'institutional'];

/** Returns true if `userTier` meets or exceeds `requiredTier`. */
export function tierSatisfies(
  userTier: AccreditationTier,
  requiredTier: AccreditationTier,
): boolean {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}

/** Annual investment caps per tier in USD. Institutional has no cap (Infinity). */
export const ANNUAL_CAP_USD: Record<AccreditationTier, number> = {
  retail: 10_000,
  accredited: Infinity, // no annual cap — per-deal cap of $50,000 applies instead
  institutional: Infinity,
};

/** Per-deal investment caps in USD. */
export const PER_DEAL_CAP_USD: Record<AccreditationTier, number> = {
  retail: 5_000,
  accredited: 50_000,
  institutional: Infinity,
};

export interface CompanyDetails {
  companyName?: string;
  registrationNumber?: string;
  articlesOfIncorporationUrl?: string;
}

/**
 * Appearance preferences stored on the user profile (#1170).
 * Kept in sync across devices so the theme follows the user.
 */
export interface ThemePreferences {
  /** light | dark | high-contrast | system */
  variant?: string;
  /** Accent palette identifier. */
  accent?: string;
  /** small | medium | large | extra-large */
  fontSize?: string;
  /** normal | high | extra-high */
  contrast?: string;
  /** Custom brand colour as an "H S% L%" triplet. */
  customBrandColor?: string | null;
  customBrandColorDark?: string | null;
  customBrandFg?: string | null;
  customBrandFgDark?: string | null;
  customAccentColor?: string | null;
  customAccentColorDark?: string | null;
  customAccentFg?: string | null;
  customAccentFgDark?: string | null;
  /** ISO timestamp of the last change — used to resolve sync conflicts. */
  updatedAt?: string;
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
    enum: ['farmer', 'trader', 'investor', 'company_admin', 'admin', 'compliance_officer'],
    example: 'farmer',
  })
  role: UserRole;

  @Column({ name: 'compliance_domain', type: 'varchar', nullable: true })
  complianceDomain: string | null;

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

  /**
   * JWT token version for invalidation (#961).
   *
   * Bumped atomically via `UPDATE ... SET token_version = token_version + 1`
   * inside the same DB transaction that persists rotated refresh tokens, so
   * concurrent logins/refreshes cannot clobber each other's increments.
   */
  @Column({ name: 'token_version', default: 0 })
  @ApiProperty({
    description: 'JWT token version for invalidation',
    example: 0,
  })
  tokenVersion: number;

  /**
   * Optimistic-lock version (#961). TypeORM increments this on every save,
   * causing concurrent writes to fail with a version mismatch instead of
   * silently overwriting each other's counter updates.
   */
  @VersionColumn()
  @Exclude()
  version: number;

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

  // #1414 — pending email change (verified before it becomes the live email)
  @Column({ name: 'email_pending', type: 'varchar', nullable: true })
  @ApiProperty({
    description: 'Pending email address awaiting verification',
    nullable: true,
    example: 'new-address@agri-fi.com',
  })
  emailPending: string | null;

  @Exclude()
  @Column({
    name: 'email_change_token',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  emailChangeToken: string | null;

  @Column({
    name: 'email_change_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  emailChangeTokenExpiresAt: Date | null;

  @Column({
    name: 'pending_email_requested_at',
    type: 'timestamptz',
    nullable: true,
  })
  pendingEmailRequestedAt: Date | null;

  // #413 — account lockout
  /**
   * Failed login attempts (#961).
   *
   * Incremented atomically via `UPDATE ... SET failed_login_attempts =
   * failed_login_attempts + 1` (or the Redis INCRBY path) so concurrent
   * failures cannot be masked by a lost read-modify-write.
   */
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
    description:
      'Whether this admin account must complete MFA enrollment before accessing the platform',
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
  @Column({
    name: 'preferred_language',
    type: 'varchar',
    length: 8,
    default: 'en',
  })
  @ApiProperty({
    description: 'Preferred language for emails and notifications',
    enum: ['en', 'es', 'fr', 'pt', 's

/* … truncated 4666 chars — edit only what you need near the top … */
