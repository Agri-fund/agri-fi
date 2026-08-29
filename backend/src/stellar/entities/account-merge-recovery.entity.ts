import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Tracks Stellar account merges and replacement account creation.
 * When an investor's account is merged or closed, we create a replacement account
 * and establish trustlines so that payment distributions don't fail with op_no_trust.
 */
@Entity('account_merge_recovery')
@Index('idx_merged_account', ['mergedPublicKey'])
@Index('idx_replacement_account', ['replacementPublicKey'])
@Index('idx_original_investor', ['originalInvestorId'])
export class AccountMergeRecovery {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique recovery record ID' })
  id: string;

  @Column({ type: 'varchar', length: 56 })
  @ApiProperty({
    description: 'Stellar public key of the original account before merge',
    example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  })
  originalPublicKey: string;

  @Column({ type: 'varchar', length: 56 })
  @ApiProperty({
    description: 'Stellar public key of the account that received the merge',
    example: 'GBQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W38',
  })
  mergedPublicKey: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  @ApiProperty({
    description:
      'Stellar public key of the replacement account created for recovery (null if merge target is being tracked)',
    nullable: true,
  })
  replacementPublicKey: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  @ApiProperty({
    description: 'Encrypted replacement account secret key (stored securely)',
    nullable: true,
  })
  replacementSecretKeyEncrypted: string | null;

  @Column({ type: 'uuid', nullable: true })
  @ApiProperty({
    description: 'User ID (investor) associated with this recovery',
    nullable: true,
  })
  originalInvestorId: string | null;

  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({
    description: 'Recovery status',
    enum: [
      'detected',
      'replacement_created',
      'trustline_established',
      'payment_retried',
      'failed',
    ],
  })
  status:
    | 'detected'
    | 'replacement_created'
    | 'trustline_established'
    | 'payment_retried'
    | 'failed';

  @Column({ type: 'varchar', length: 100, nullable: true })
  @ApiProperty({
    description: 'Horizon transaction hash that detected the merge',
    nullable: true,
  })
  detectedInTxHash: string | null;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({
    description: 'Number of payment retry attempts after recovery',
    example: 0,
  })
  paymentRetryAttempts: number;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({
    description: 'Error message from most recent failed recovery attempt',
    nullable: true,
  })
  lastErrorMessage: string | null;

  @CreateDateColumn()
  @ApiProperty({
    description: 'Timestamp when this recovery was first detected',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Timestamp when recovery completed successfully',
    nullable: true,
  })
  recoveredAt: Date | null;
}
