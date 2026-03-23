import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from './trade-deal.entity';

export type DocumentType = 
  | 'purchase_agreement'
  | 'bill_of_lading'
  | 'export_certificate'
  | 'warehouse_receipt';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => TradeDeal, tradeDeal => tradeDeal.documents)
  tradeDeal: TradeDeal;

  @ManyToOne(() => User)
  uploader: User;
}
