import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DealFilters } from '../deal-filters';

@Entity('search_history')
@Index(['userId', 'createdAt'])
export class SearchHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'jsonb' })
  filters: DealFilters;

  @Column({ name: 'result_count', type: 'integer', default: 0 })
  resultCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
