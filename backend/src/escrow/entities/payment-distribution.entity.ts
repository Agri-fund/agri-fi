import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

export type RecipientType = 'farmer' | 'investor' | 'platform';
export type PaymentStatus = 'confirmed' | 'failed';

@Entity('payment_distributions')
export class PaymentDistribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @ManyToOne(() => TradeDeal)
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'recipient_type' })
  recipientType: RecipientType;

  @Column({ name: 'recipient_id', nullable: true })
  recipientId: string | null; // User ID for farmer/investor, null for platform

  @Column({ name: 'wallet_address' })
  walletAddress: string;

  @Column({ name: 'amount_usd', type: 'numeric' })
  amountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({
    type: 'text',
    default: 'confirmed',
  })
  status: PaymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
