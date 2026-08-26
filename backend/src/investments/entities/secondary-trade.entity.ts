import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

export enum SecondaryTradeStatus {
  PENDING = 'pending',
  SETTLED = 'settled',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('secondary_trades')
export class SecondaryTrade {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique secondary trade identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @Column({ name: 'order_id', length: 100, unique: true })
  @ApiProperty({
    description: 'Marketplace order ID from Soroban contract',
    example: 'order-12345',
  })
  orderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ name: 'seller_id' })
  @ApiProperty({
    description: 'Seller user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  sellerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @Column({ name: 'buyer_id' })
  @ApiProperty({
    description: 'Buyer user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  buyerId: string;

  @Column({ name: 'token_code', length: 20 })
  @ApiProperty({
    description: 'Token code being traded',
    example: 'FARM001',
  })
  tokenCode: string;

  @Column({ name: 'token_amount', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Number of tokens traded',
    example: 100.0,
  })
  tokenAmount: number;

  @Column({ name: 'price_per_token', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Price per token in USD',
    example: 10.50,
  })
  pricePerToken: number;

  @Column({ name: 'total_amount_usd', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Total trade amount in USD',
    example: 1050.0,
  })
  totalAmountUsd: number;

  @Column({ name: 'platform_fee_usd', type: 'decimal', precision: 36, scale: 7, default: 0 })
  @ApiProperty({
    description: 'Platform fee deducted in USD',
    example: 21.0,
  })
  platformFeeUsd: number;

  @Column({ name: 'net_amount_usd', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Net amount after fees in USD',
    example: 1029.0,
  })
  netAmountUsd: number;

  @Column({ name: 'tx_hash', length: 100, nullable: true })
  @ApiProperty({
    description: 'Soroban transaction hash',
    nullable: true,
    example: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  txHash: string | null;

  @Column({ length: 50, default: SecondaryTradeStatus.PENDING })
  @ApiProperty({
    description: 'Trade status',
    enum: SecondaryTradeStatus,
    example: SecondaryTradeStatus.PENDING,
  })
  status: SecondaryTradeStatus;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Settlement timestamp',
    nullable: true,
    example: '2024-01-15T10:30:00Z',
  })
  settledAt: Date | null;

  @Column({ name: 'seller_notified', default: false })
  @ApiProperty({
    description: 'Whether seller has been notified',
    example: false,
  })
  sellerNotified: boolean;

  @Column({ name: 'buyer_notified', default: false })
  @ApiProperty({
    description: 'Whether buyer has been notified',
    example: false,
  })
  buyerNotified: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  @ApiProperty({
    description: 'Additional metadata',
    example: {},
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Trade creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: Date;
}
