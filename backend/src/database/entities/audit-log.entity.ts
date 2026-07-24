import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_name' })
  entityName: string;

  @Column({ name: 'entity_id', nullable: true })
  entityId: string | null;

  @Column({ length: 20 })
  action: 'INSERT' | 'UPDATE' | 'DELETE';

  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues: Record<string, unknown> | null;

  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  changes: string | null;

  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
