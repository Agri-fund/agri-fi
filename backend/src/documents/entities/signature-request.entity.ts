import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Document } from '../../trade-deals/entities/document.entity';
import { User } from '../../auth/entities/user.entity';

export type SignatureRequestStatus =
  | 'pending'
  | 'signed'
  | 'expired'
  | 'revoked';

export type SignatureMethod = 'sep10' | 'openpgp';

@Entity('signature_requests')
@Index(['coSignerId'])
@Index(['status'])
@Index(['signingTokenExpiresAt'])
export class SignatureRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'co_signer_id' })
  coSignerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'co_signer_id' })
  coSigner: User;

  @Column({ name: 'requester_id' })
  requesterId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_id' })
  requester: User;

  @Column({ type: 'text', default: 'pending' })
  status: SignatureRequestStatus;

  @Column({
    name: 'signing_token',
    type: 'text',
    select: false,
  })
  signingToken: string;

  @Column({ name: 'signing_token_hash', type: 'text', select: false })
  signingTokenHash: string;

  @Column({ name: 'signing_token_expires_at', type: 'timestamptz' })
  signingTokenExpiresAt: Date;

  @Column({
    name: 'pfp_hash',
    type: 'text',
    nullable: true,
  })
  pfpHash: string | null;

  @Column({
    name: 'stellar_tx_id',
    type: 'text',
    nullable: true,
  })
  stellarTxId: string | null;

  @Column({
    name: 'signature_method',
    type: 'text',
    nullable: true,
  })
  signatureMethod: SignatureMethod | null;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
