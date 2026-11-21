import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import { DocumentScanHealthIndicator } from './document-scan.health-indicator';
import { QueueModule } from '../queue/queue.module';
import { ClamScanService } from '../documents/clam-scan.service';

@Module({
  imports: [TerminusModule, ConfigModule, QueueModule],
  controllers: [HealthController],
  providers: [
    RabbitmqHealthIndicator,
    RedisHealthIndicator,
    DocumentScanHealthIndicator,
    // Provided directly rather than importing DocumentsModule: the indicator
    // only needs the ClamAV TCP probe, and DocumentsModule pulls in Stellar,
    // settlement and storage providers that health checks must not depend on.
    ClamScanService,
  ],
})
export class HealthModule {}