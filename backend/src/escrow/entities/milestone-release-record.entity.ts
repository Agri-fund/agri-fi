import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { MilestoneType } from '../../shipments/entities/shipment-milestone.entity';

@Entity('milestone_release_records')
@Index(['tradeDealId', 'milestoneType'], { unique: true })
@Index(['tradeDealId'])
export class MilestoneReleaseRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @ManyToOne(() => TradeDeal)
  @JoinColumn({ name: 'trade_deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'milestone_type' })
  milestoneType: MilestoneType;

  @Column({
    name: 'release_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  releasePct: number;

  @Column({
    name: 'farmer_amount_usd',
    type: 'decimal',
    precision: 36,
    scale: 7,
  })
  farmerAmountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
