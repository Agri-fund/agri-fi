import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('storage_content')
export class StorageContent {
  @PrimaryColumn({ name: 'cid', type: 'varchar', length: 128 })
  cid: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: number;

  @Column({ name: 'replica_count', type: 'int', default: 1 })
  replicaCount: number;

  @Column({ name: 'retrieval_count', type: 'int', default: 0 })
  retrievalCount: number;

  @Column({ name: 'average_retrieval_ms', type: 'float', default: 0 })
  averageRetrievalMs: number;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ name: 'last_accessed_at', type: 'timestamptz', nullable: true })
  lastAccessedAt: Date | null;

  @Column({ name: 'retention_until', type: 'timestamptz', nullable: true })
  retentionUntil: Date | null;

  @Column({ name: 'legal_hold', type: 'boolean', default: false })
  legalHold: boolean;

  @Column({ name: 'archived', type: 'boolean', default: false })
  archived: boolean;

  @Column({ name: 'archive_key', type: 'varchar', length: 512, nullable: true })
  archiveKey: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
