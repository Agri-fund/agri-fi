import { Controller, Get, Version } from '@nestjs/common';
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
import {
  StellarHealthIndicator,
  StellarHealthDetails,
} from './stellar.health-indicator';

@ApiTags('health')
@Version('1')
@Controller('health')
@SkipThrottle() // Health check is called by Kubernetes liveness/readiness probes — exempt from rate limiting
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private rabbitmq: RabbitmqHealthIndicator,
    private stellar: StellarHealthIndicator,
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

  @Get('stellar')
  @HealthCheck()
  @ApiOperation({
    summary: 'Stellar Horizon failover health check',
    description:
      'Returns the active Horizon node, its latency, and status of all fallback nodes. ' +
      'Does not perform active health checks; uses cached status from recent operations. ' +
      'Returns 200 if at least one node is healthy, 503 if all nodes are down.',
  })
  @ApiResponse({
    status: 200,
    description: 'At least one Horizon node is healthy',
    schema: {
      example: {
        status: 'ok',
        stellar: {
          status: 'up',
          details: {
            activeNode: {
              url: 'https://horizon.stellar.org',
              latencyMs: 145,
            },
            nodes: [
              {
                url: 'https://horizon.stellar.org',
                healthy: true,
                latencyMs: 145,
                checkedAt: '2024-01-15T10:30:00.000Z',
              },
              {
                url: 'https://horizon-testnet.stellar.org',
                healthy: true,
                latencyMs: 892,
                checkedAt: '2024-01-15T10:29:55.000Z',
              },
            ],
            allNodesHealthy: true,
            anyNodeHealthy: true,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'All Horizon nodes are unreachable',
  })
  async checkStellar() {
    return this.health.check([() => this.stellar.isHealthy('stellar')]);
  }

  @Get('stellar/check')
  @HealthCheck()
  @ApiOperation({
    summary: 'Active Stellar Horizon health check',
    description:
      'Performs live health checks against all Horizon nodes by connecting to each. ' +
      'More expensive than GET /health/stellar but provides current status. ' +
      'Should not be called frequently (use for debugging or on-demand checks).',
  })
  @ApiResponse({
    status: 200,
    description: 'At least one Horizon node is healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'All Horizon nodes are unreachable',
  })
  async checkStellarActive() {
    return this.health.check([() => this.stellar.checkAllNodes('stellar')]);
  }
}
