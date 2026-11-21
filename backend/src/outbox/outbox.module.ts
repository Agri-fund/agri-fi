import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import {
  PrometheusModule,
  makeGaugeProvider,
  makeCounterProvider,
} from '@willsoto/nestjs-prometheus';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';
import { OutboxProcessor, OUTBOX_REDIS_CLIENT } from './outbox.processor';
import { RedisConfig } from '../config/redis.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEntity]),
    ScheduleModule.forRoot(),
    PrometheusModule.register(),
  ],
  providers: [
    RedisConfig,
    {
      provide: OUTBOX_REDIS_CLIENT,
      inject: [RedisConfig],
      useFactory: (redisConfig: RedisConfig) => redisConfig.createClient(),
    },
    makeCounterProvider({
      name: 'outbox_lease_contention_total',
      help: 'Ticks skipped because another replica held the outbox lease.',
    }),
    makeGaugeProvider({
      name: 'outbox_processor_active',
      help: '1 while this instance holds the outbox processor lease.',
    }),
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
