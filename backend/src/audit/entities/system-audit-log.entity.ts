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

  @Column({ type: 'varchar', nullable: true })
  action: string | null;

  @Column({ name: 'resource_type', type: 'varchar', nullable: true })
  resourceType: string | null;

  @Column({ name: 'resource_id', type: 'varchar', nullable: true })
  resourceId: string | null;

  @Column({ name: 'compliance_domain', type: 'varchar', nullable: true })
  complianceDomain: string | null;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ name: 'request_details', type: 'jsonb', nullable: true })
  requestDetails: Record<string, any> | null;

  @Column({ name: 'log_type', type: 'varchar', default: 'operational' })
  logType: string;

  @Column({
    name: 'retention_period',
    type: 'varchar',
    default: '1 year',
  })
  retentionPeriod: string;

  @Column({
    name: 'retention_until',
    type: 'timestamptz',
    default: () => "(now() + interval '1 year')",
  })
  retentionUntil: Date;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeUpdate()
  preventUpdate(): void {
    throw new Error(
      'SystemAuditLog entries are immutable and cannot be updated.',
    );
  }

  @BeforeRemove()
  preventRemove(): void {
    throw new Error(
      'SystemAuditLog entries are immutable and cannot be deleted.',
    );
  }
}
