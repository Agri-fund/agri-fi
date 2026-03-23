import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from './trade-deal.entity';

export type InvestmentStatus = 'pending' | 'confirmed' | 'failed';

@Entity('investments')
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @ManyToOne(() => TradeDeal, { eager: true })
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'investor_id' })
  investorId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'investor_id' })
  investor: User;

  @Column({ name: 'token_amount' })
  tokenAmount: number;

  @Column({ name: 'amount_usd', type: 'numeric' })
  amountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({
    type: 'text',
    default: 'pending',
  })
  status: InvestmentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
