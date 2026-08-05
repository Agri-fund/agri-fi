import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [TerminusModule, ConfigModule, QueueModule],
  controllers: [HealthController],
  providers: [RabbitmqHealthIndicator],
})
export class HealthModule {}
