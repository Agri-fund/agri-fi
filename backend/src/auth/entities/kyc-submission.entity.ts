import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from './user.entity';
import { encryptionTransformer } from '../../common/encryption.transformer';

export type KycSubmissionStatus = 'pending_review' | 'approved' | 'rejected' | 'expired';

@Entity('kyc_submissions')
export class KycSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'government_id_url', nullable: true })
  governmentIdUrl: string;

  @Column({ name: 'identity_document_back_url', nullable: true })
  identityDocumentBackUrl: string;

  @Column({ name: 'proof_of_address_url', nullable: true })
  proofOfAddressUrl: string;

  @Column({ name: 'selfie_url', nullable: true })
  selfieUrl: string;

  @Column({ name: 'is_corporate', default: false })
  isCorporate: boolean;

  /** Company / business name — stored encrypted (PII) */
  @Exclude()
  @Column({ name: 'company_name', nullable: true, transformer: encryptionTransformer })
  companyName: string;

  /** Company registration number — stored encrypted (PII) */
  @Exclude()
  @Column({ name: 'registration_number', nullable: true, transformer: encryptionTransformer })
  registrationNumber: string;

  @Column({ name: 'business_license_url', nullable: true })
  businessLicenseUrl: string;

  @Column({ name: 'articles_of_incorporation_url', nullable: true })
  articlesOfIncorporationUrl: string;

  @Column({ name: 'document_expires_at', type: 'timestamptz', nullable: true })
  documentExpiresAt: Date | null;

  @Column({ name: 'alert_30_sent_at', type: 'timestamptz', nullable: true })
  alert30SentAt: Date | null;

  @Column({ name: 'alert_15_sent_at', type: 'timestamptz', nullable: true })
  alert15SentAt: Date | null;

  @Column({ name: 'alert_3_sent_at', type: 'timestamptz', nullable: true })
  alert3SentAt: Date | null;

  @Column({ default: 'pending_review' })
  status: KycSubmissionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
