import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from './trade-deal.entity';

export enum PriceNegotiationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  COUNTERED = 'COUNTERED',
}

@Entity('price_negotiations')
@Index(['dealId', 'createdAt'])
export class PriceNegotiation {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique negotiation record identifier (UUID)',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  id: string;

  @Index()
  @Column({ name: 'deal_id', type: 'uuid' })
  @ApiProperty({
    description: 'Trade deal UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  dealId: string;

  @ManyToOne(() => TradeDeal, (deal) => (deal as any).priceNegotiations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'deal_id' })
  deal: TradeDeal;

  @Index()
  @Column({ name: 'proposer_id', type: 'uuid' })
  @ApiProperty({
    description: 'User UUID of the proposer (farmer or trader)',
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  })
  proposerId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'proposer_id' })
  proposer: User;

  @Column({
    name: 'proposed_price',
    type: 'decimal',
    precision: 36,
    scale: 7,
  })
  @ApiProperty({
    description: 'Proposed total commodity value / price in USD',
    example: '48500.00',
  })
  proposedPrice: number;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({
    description: 'Optional negotiation message or counter-offer reasoning',
    nullable: true,
    example: 'Offering $48,500 based on current spot market prices and shipping logistics.',
  })
  message: string | null;

  @Index()
  @Column({
    type: 'varchar',
    length: 32,
    default: PriceNegotiationStatus.PENDING,
  })
  @ApiProperty({
    description: 'Current status of this negotiation round',
    enum: PriceNegotiationStatus,
    example: PriceNegotiationStatus.PENDING,
  })
  status: PriceNegotiationStatus;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({
    description: 'Timestamp when this proposal was submitted',
  })
  createdAt: Date;
}
