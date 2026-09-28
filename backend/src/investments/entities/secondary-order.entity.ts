import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

/**
 * Order intent placed on the secondary market.
 *
 * This replaces the earlier split `secondary_sell_orders` / `secondary_buy_orders`
 * tables, which modelled the same book twice. A single table keyed by `side`
 * keeps one book, one status enum and one matching path.
 *
 * `limit` rests on the book and may fill partially.
 * `fok` (fill-or-kill) is atomic: if the full size cannot be matched against
 * the opposing book at submission time the order is cancelled outright.
 * `stop_loss` is dormant until the market price crosses `triggerPrice`, at
 * which point it becomes an ordinary resting order.
 */
export enum SecondaryOrderType {
  LIMIT = 'limit',
  FOK = 'fok',
  STOP_LOSS = 'stop_loss',
}

export enum SecondaryOrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum SecondaryOrderStatus {
  OPEN = 'open',
  TRIGGERED = 'triggered',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/** Direction in which the market price must move to arm a stop order. */
export enum StopLossDirection {
  ABOVE = 'above',
  BELOW = 'below',
}

@Entity('secondary_orders')
@Index('IDX_secondary_orders_book', [
  'tokenCode',
  'side',
  'status',
  'pricePerToken',
])
export class SecondaryOrder {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique secondary order identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @Column({ name: 'order_id', length: 100, unique: true })
  @ApiProperty({
    description:
      'Order ID shared with the marketplace_settlement Soroban contract',
    example: 'sord-1710000000000-a1b2c3',
  })
  orderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  @ApiProperty({
    description: 'Maker user UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  userId: string;

  /**
   * Carried over from the split tables. The old sell order was scoped to a
   * single investment within a deal, so both are retained to keep migrated
   * rows meaningful.
   */
  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  @ApiProperty({
    description: 'Trade deal this order belongs to, when deal-scoped',
    nullable: true,
  })
  dealId: string | null;

  @Column({ name: 'investment_id', type: 'uuid', nullable: true })
  @ApiProperty({
    description: 'Investment this order was placed against, if any',
    nullable: true,
  })
  investmentId: string | null;

  @Column({ length: 4 })
  @ApiProperty({
    description: 'Order side',
    enum: SecondaryOrderSide,
    example: SecondaryOrderSide.SELL,
  })
  side: SecondaryOrderSide;

  @Column({ length: 20, default: SecondaryOrderType.LIMIT })
  @ApiProperty({
    description: 'Order type',
    enum: SecondaryOrderType,
    example: SecondaryOrderType.LIMIT,
  })
  type: SecondaryOrderType;

  @Column({ name: 'token_code', length: 20 })
  @ApiProperty({
    description: 'Token code being traded',
    example: 'FARM001',
  })
  tokenCode: string;

  @Column({ name: 'token_amount', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Total token amount requested by the order',
    example: 100,
  })
  tokenAmount: number;

  @Column({
    name: 'filled_amount',
    type: 'decimal',
    precision: 36,
    scale: 7,
    default: 0,
  })
  @ApiProperty({
    description: 'Token amount matched so far',
    example: 40,
  })
  filledAmount: number;

  @Column({ name: 'price_per_token', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({
    description: 'Limit price per token in USD',
    example: 10.5,
  })
  pricePerToken: number;

  @Column({
    name: 'trigger_price',
    type: 'decimal',
    precision: 36,
    scale: 7,
    nullable: true,
  })
  @ApiProperty({
    description:
      'Market price at which a stop-loss order arms (stop_loss only)',
    nullable: true,
    example: 9,
  })
  triggerPrice: number | null;

  @Column({ name: 'stop_direction', length: 10, nullable: true })
  @ApiProperty({
    description:
      'Cross direction: "above" arms when marketPrice >= triggerPrice, ' +
      '"below" arms when marketPrice <= triggerPrice',
    enum: StopLossDirection,
    nullable: true,
    example: StopLossDirection.BELOW,
  })
  stopDirection: StopLossDirection | null;

  @Column({ length: 30, default: SecondaryOrderStatus.OPEN })
  @ApiProperty({
    description: 'Order status',
    enum: SecondaryOrderStatus,
    example: SecondaryOrderStatus.OPEN,
  })
  status: SecondaryOrderStatus;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Optional expiry; matching ignores orders past this instant',
    nullable: true,
    example: '2024-01-15T10:30:00Z',
  })
  expiresAt: Date | null;

  @Column({ name: 'triggered_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'When a stop-loss order was armed by a price crossing',
    nullable: true,
    example: '2024-01-15T10:31:00Z',
  })
  triggeredAt: Date | null;

  @Column({ name: 'filled_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'When the order reached full fill',
    nullable: true,
    example: '2024-01-15T10:32:00Z',
  })
  filledAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'When the order was cancelled or killed',
    nullable: true,
    example: '2024-01-15T10:30:05Z',
  })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', length: 100, nullable: true })
  @ApiProperty({
    description: 'Why the order left the book without a full fill',
    nullable: true,
    example: 'fok_no_liquidity',
  })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Order creation timestamp',
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
