import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from './trade-deal.entity';

export type DocumentType =
  | 'purchase_agreement'
  | 'bill_of_lading'
  | 'export_certificate'
  | 'warehouse_receipt';

export interface DocumentMetadata {
  dimensions?: {
    width: number;
    height: number;
    unit?: string;
  };
  pageCount?: number;
  detectedLanguages?: string[];
  [key: string]: any; // Allow additional metadata fields
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @Column({ name: 'uploader_id' })
  uploaderId: string;

  @Column({ name: 'doc_type' })
  docType: DocumentType;

  @Column({ name: 'ipfs_hash' })
  ipfsHash: string;

  @Column({ name: 'storage_url' })
  storageUrl: string;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({ name: 'memo_text', nullable: true })
  memoText: string | null;

  @Column({ name: 'signature_verified', default: false })
  signatureVerified: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata: DocumentMetadata;

  @Column({ name: 'verification_status', length: 20, default: 'pending' })
  verificationStatus: 'pending' | 'approved' | 'rejected';

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TradeDeal, (tradeDeal) => tradeDeal.documents)
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploader_id' })
  uploader: User;
}
