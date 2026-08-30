import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type InvestmentEventType =
  | 'InvestmentCreated'
  | 'InvestmentActivated'
  | 'InvestmentReleaseStarted'
  | 'InvestmentCompleted'
  | 'InvestmentCancelledByUser'
  | 'InvestmentRefunded'
  | 'InvestmentFailedEscrow';

@Entity('investment_events')
export class InvestmentEvent {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Event UUID' })
  id: string;

  @Index()
  @Column({ name: 'investment_id' })
  @ApiProperty({ description: 'Target investment UUID' })
  investmentId: string;

  @Column({ name: 'event_type' })
  @ApiProperty({ description: 'Event type name' })
  eventType: InvestmentEventType;

  @Column({ type: 'jsonb', default: {} })
  @ApiProperty({ description: 'Event payload object' })
  payload: Record<string, any>;

  @Column({ name: 'actor_id', nullable: true })
  @ApiProperty({ description: 'UUID of user or admin triggering the event', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ name: 'occurred_at' })
  @ApiProperty({ description: 'Timestamp when event occurred' })
  occurredAt: Date;
}
