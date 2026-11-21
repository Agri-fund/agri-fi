import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DataRetentionActionType {
  ANONYMISED = 'anonymised',
  EXEMPTED = 'exempted',
  NOTIFIED = 'notified',
}

@Entity('data_retention_log')
@Index(['userId'])
@Index(['actionType'])
@Index(['performedAt'])
export class DataRetentionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'action_type',
    type: 'enum',
    enum: DataRetentionActionType,
    default: DataRetentionActionType.ANONYMISED,
  })
  actionType: DataRetentionActionType;

  @Column({ name: 'anonymised_fields', type: 'jsonb', default: () => "'[]'" })
  anonymisedFields: string[];

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'performed_at', type: 'timestamptz' })
  performedAt: Date;
}