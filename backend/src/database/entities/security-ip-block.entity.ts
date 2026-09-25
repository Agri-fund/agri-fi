import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type SecurityBlockType =
  /** CAPTCHA required for a targeted email address on next login. */
  | 'captcha_email'
  /** Global (not per-IP) rate limit applied to a targeted email address. */
  | 'email_ratelimit'
  /** /16 subnet block proposed by detection — requires manual approval. */
  | 'subnet_pending'
  /** /16 subnet block approved by an admin and actively enforced. */
  | 'subnet_active';

/**
 * Persisted record of an automated or manual security enforcement action
 * produced by credential-stuffing detection (#898).
 */
@Entity('security_ip_blocks')
@Index(['type'])
@Index(['cidr'])
export class SecurityIpBlock {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique block identifier (UUID)' })
  id: string;

  @Column({ type: 'text' })
  @ApiProperty({
    description: 'Block type',
    enum: [
      'captcha_email',
      'email_ratelimit',
      'subnet_pending',
      'subnet_active',
    ],
    example: 'subnet_pending',
  })
  type: SecurityBlockType;

  /**
   * Target of the block:
   * - email address for captcha_email / email_ratelimit
   * - CIDR notation (e.g. "203.0.113.0/16") for subnet blocks
   */
  @Column({ name: 'cidr', type: 'text' })
  @ApiProperty({
    description: 'Email address or CIDR range this block applies to',
  })
  cidr: string;

  @Column({ type: 'text' })
  @ApiProperty({
    description: 'Why this block was created',
    example: 'credential_stuffing',
  })
  reason: string;

  /** Free-form detection metadata: signal thresholds hit, sample IPs, etc. */
  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Detection metadata', required: false })
  metadata: Record<string, unknown> | null;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Admin who approved the block (subnet blocks)',
    required: false,
  })
  approvedBy: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'When the block automatically expires',
    required: false,
  })
  expiresAt: Date | null;

  @Column({ default: true })
  @ApiProperty({ description: 'Whether the block is currently enforced' })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
