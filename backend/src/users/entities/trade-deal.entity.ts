import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Investment } from './investment.entity';
import { ShipmentMilestone } from '../../shipments/entities/shipment-milestone.entity';

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

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'farmer_id' })
  farmer: User;

  @Column({ name: 'trader_id' })
  traderId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'trader_id' })
  trader: User;

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

  @OneToMany(() => Investment, investment => investment.tradeDeal)
  investments: Investment[];

  @OneToMany(() => ShipmentMilestone, milestone => (milestone as any).tradeDeal)
  milestones: ShipmentMilestone[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
