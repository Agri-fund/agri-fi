import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DealFilters } from '../deal-filters';

/** An investor's named marketplace filter, optionally alerting on new matches. */
@Entity('saved_searches')
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'jsonb' })
  filters: DealFilters;

  @Column({ name: 'notify_in_app', type: 'boolean', default: true })
  notifyInApp: boolean;

  @Column({ name: 'notify_email', type: 'boolean', default: false })
  notifyEmail: boolean;

  /** Deals this search has already matched (or matched when it was saved). */
  @Column({ name: 'seen_deal_ids', type: 'jsonb', default: () => "'[]'" })
  seenDealIds: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
