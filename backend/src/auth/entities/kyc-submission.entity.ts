import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export type KycSubmissionStatus = 'pending_review' | 'approved' | 'rejected';

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

  @Column({ name: 'proof_of_address_url', nullable: true })
  proofOfAddressUrl: string;

  @Column({ name: 'is_corporate', default: false })
  isCorporate: boolean;

  @Column({ name: 'company_name', nullable: true })
  companyName: string;

  @Column({ name: 'registration_number', nullable: true })
  registrationNumber: string;

  @Column({ name: 'business_license_url', nullable: true })
  businessLicenseUrl: string;

  @Column({ name: 'articles_of_incorporation_url', nullable: true })
  articlesOfIncorporationUrl: string;

  @Column({ default: 'pending_review' })
  status: KycSubmissionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
