import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

export enum InvestmentStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('investments')
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique investment identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'trade_deal_id' })
  @ApiProperty({
    description: 'Associated trade deal UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  tradeDealId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'investor_id' })
  investor: User;

  @Column({ name: 'investor_id' })
  @ApiProperty({
    description: 'Investor user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  investorId: string;

  @Column({ name: 'token_amount' })
  @ApiProperty({
    description: 'Number of tokens purchased',
    example: 1000,
  })
  tokenAmount: number;

  @Column({ name: 'amount_usd', type: 'numeric', precision: 10, scale: 2 })
  @ApiProperty({
    description: 'Investment amount in USD',
    example: '10000.00',
  })
  amountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  @ApiProperty({
    description: 'Stellar transaction ID (set once confirmed on-chain)',
    nullable: true,
    example: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  stellarTxId: string;

  @Column({ name: 'compliance_data', type: 'jsonb', nullable: true })
  @ApiProperty({
    description: 'Compliance metadata (tax ID, source of funds, etc.)',
    nullable: true,
    example: { taxId: '123-45-6789', sourceOfFunds: 'business' },
  })
  complianceData: Record<string, unknown> | null;

  @Column({
    type: 'text',
    default: InvestmentStatus.PENDING,
  })
  @ApiProperty({
    description: 'Investment status',
    enum: ['pending', 'confirmed', 'failed', 'refunded'],
    example: 'confirmed',
  })
  status: InvestmentStatus;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Investment creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;
}
