import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('compliance_reports')
export class ComplianceReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'report_type' })
  reportType: string;

  @Column()
  title: string;

  @Column({ name: 's3_key' })
  s3Key: string;

  /** SHA-256 hex digest of the PDF bytes — tamper evidence. */
  @Column({ name: 'sha256_hash' })
  sha256Hash: string;

  @Column({ name: 'report_data', type: 'jsonb', nullable: true })
  reportData: Record<string, unknown> | null;

  @Index()
  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Index()
  @CreateDateColumn({ name: 'generated_at' })
  generatedAt: Date;
}
