import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum OrderStatus {
  OPEN = 'open',
  FILLED = 'filled',
  PARTIALLY_FILLED = 'partially_filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('secondary_sell_orders')
export class SellOrder {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Sell order ID' })
  id: string;

  @Column({ name: 'investment_id' })
  @ApiProperty({ description: 'Associated investment ID' })
  investmentId: string;

  @Column({ name: 'seller_id' })
  @ApiProperty({ description: 'Seller user ID' })
  sellerId: string;

  @Column({ name: 'deal_id' })
  @ApiProperty({ description: 'Trade deal ID' })
  dealId: string;

  @Column({ name: 'ask_price', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({ description: 'Ask price per token in USD' })
  askPrice: number;

  @Column({ type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({ description: 'Token quantity offered for sale' })
  quantity: number;

  @Column({ name: 'filled_quantity', type: 'decimal', precision: 36, scale: 7, default: 0 })
  @ApiProperty({ description: 'Token quantity already filled' })
  filledQuantity: number;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Order expiry timestamp' })
  expiry: Date | null;

  @Column({ type: 'varchar', length: 30, default: OrderStatus.OPEN })
  @ApiProperty({ enum: OrderStatus, description: 'Order status' })
  status: OrderStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('secondary_buy_orders')
export class BuyOrder {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Buy order ID' })
  id: string;

  @Column({ name: 'deal_id' })
  @ApiProperty({ description: 'Trade deal ID' })
  dealId: string;

  @Column({ name: 'buyer_id' })
  @ApiProperty({ description: 'Buyer user ID' })
  buyerId: string;

  @Column({ name: 'bid_price', type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({ description: 'Bid price per token in USD' })
  bidPrice: number;

  @Column({ type: 'decimal', precision: 36, scale: 7 })
  @ApiProperty({ description: 'Token quantity requested' })
  quantity: number;

  @Column({ name: 'filled_quantity', type: 'decimal', precision: 36, scale: 7, default: 0 })
  @ApiProperty({ description: 'Token quantity already filled' })
  filledQuantity: number;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Order expiry timestamp' })
  expiry: Date | null;

  @Column({ type: 'varchar', length: 30, default: OrderStatus.OPEN })
  @ApiProperty({ enum: OrderStatus, description: 'Order status' })
  status: OrderStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
