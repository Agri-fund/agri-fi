import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // Health check is called by Kubernetes liveness/readiness probes — exempt from rate limiting
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private rabbitmq: RabbitmqHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check for database, queue, and system resources',
  })
  @ApiResponse({ status: 200, description: 'All services healthy' })
  @ApiResponse({ status: 503, description: 'Service unavailable' })
  async check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      // Checks the live ClientProxy connection used by QueueService so that
      // a broker outage is reflected immediately rather than on the next
      // publish attempt.
      () => this.rabbitmq.isHealthy('rabbitmq'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.05,
        }),
    ]);
  }
}
