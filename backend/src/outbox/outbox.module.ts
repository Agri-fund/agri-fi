import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PrometheusModule, makeGaugeProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';
import { OutboxProcessor } from './outbox.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEntity]),
    ScheduleModule.forRoot(),
    PrometheusModule.register(),
  ],
  providers: [
    OutboxService,
    OutboxProcessor,
    makeGaugeProvider({
      name: 'outbox_pending_events_total',
      help: 'Number of unprocessed outbox events pending publication.',
    }),
    makeCounterProvider({
      name: 'outbox_publish_errors_total',
      help: 'Total number of outbox event publish failures, labelled by event type.',
      labelNames: ['event_type'],
    }),
  ],
  exports: [OutboxService],
})
export class OutboxModule {}