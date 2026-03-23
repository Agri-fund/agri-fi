import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Document } from './document.entity';

export type DealStatus = 'draft' | 'open' | 'funded' | 'delivered' | 'completed' | 'failed';

@Entity('trade_deals')
export class TradeDeal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  commodity: string;

  @Column({ type: 'numeric' })
  quantity: number;

  @Column({ name: 'quantity_unit', default: 'kg' })
  quantityUnit: string;

  @Column({ name: 'total_value', type: 'numeric' })
  totalValue: number;

  @Column({ name: 'token_count' })
  tokenCount: number;

  @Column({ name: 'token_symbol', unique: true })
  tokenSymbol: string;

  @Column({
    type: 'text',
    default: 'draft',
  })
  status: DealStatus;

  @Column({ name: 'farmer_id' })
  farmerId: string;

  @Column({ name: 'trader_id' })
  traderId: string;

  @Column({ name: 'escrow_public_key', nullable: true })
  escrowPublicKey: string | null;

  @Column({ name: 'escrow_secret_key', nullable: true })
  escrowSecretKey: string | null;

  @Column({ name: 'issuer_public_key', nullable: true })
  issuerPublicKey: string | null;

  @Column({ name: 'total_invested', type: 'numeric', default: 0 })
  totalInvested: number;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate: Date;

  @Column({ name: 'stellar_asset_tx_id', nullable: true })
  stellarAssetTxId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => User, { eager: false })
  farmer: User;

  @ManyToOne(() => User, { eager: false })
  trader: User;

  @OneToMany(() => Document, document => document.tradeDeal)
  documents: Document[];
}
