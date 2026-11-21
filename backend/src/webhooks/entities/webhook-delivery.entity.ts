import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** `failed` means retries are exhausted: the delivery sits in the DLQ. */
export type WebhookDeliveryStatus =
  'pending' | 'retrying' | 'delivered' | 'failed';

export interface WebhookDeliveryAttempt {
  attempt: number;
  at: string;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

@Entity('webhook_deliveries')
@Index(['status', 'nextAttemptAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @Column({ type: 'varchar', length: 100 })
  event: string;

  /** Exact JSON string that is signed and sent. */
  @Column({ type: 'text' })
  payload: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: WebhookDeliveryStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'last_status_code', type: 'integer', nullable: true })
  lastStatusCode: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** Log of every delivery attempt (timestamp, response code, error). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  attempts: WebhookDeliveryAttempt[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
