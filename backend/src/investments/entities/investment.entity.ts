import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

export enum InvestmentStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@Entity('investments')
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'investor_id' })
  investor: User;

  @Column({ name: 'investor_id' })
  investorId: string;

  @Column({ name: 'token_amount' })
  tokenAmount: number;

  @Column({ name: 'amount_usd', type: 'numeric', precision: 10, scale: 2 })
  amountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string;

  @Column({ name: 'compliance_data', type: 'jsonb', nullable: true })
  complianceData: Record<string, unknown> | null;

  @Column({
    type: 'text',
    default: InvestmentStatus.PENDING,
  })
  status: InvestmentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
