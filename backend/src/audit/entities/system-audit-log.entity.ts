import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BeforeUpdate,
  BeforeRemove,
} from 'typeorm';

@Entity('system_audit_logs')
export class SystemAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar' })
  route: string;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ name: 'request_details', type: 'jsonb', nullable: true })
  requestDetails: Record<string, any> | null;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;

  @BeforeUpdate()
  preventUpdate(): void {
    throw new Error('SystemAuditLog entries are immutable and cannot be updated.');
  }

  @BeforeRemove()
  preventRemove(): void {
    throw new Error('SystemAuditLog entries are immutable and cannot be deleted.');
  }
}
