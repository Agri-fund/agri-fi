import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsIpGuard } from './metrics-ip.guard';
import { DatabaseModule } from '../database/database.module';
import { DatabaseConfig } from '../database/database.config';
import { ConfigModule } from '@nestjs/config';

/**
 * MetricsCollector drives the periodic refresh of Gauge metrics that cannot
 * be derived from request-level events:
 *   - nodejs_memory_heap_used_bytes   (process heap usage)
 *   - nodejs_memory_rss_bytes         (resident set size)
 *   - db_connections_total            (active + idle DB connections)
 *   - db_connections_idle             (idle DB connections)
 */
class MetricsCollector implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetricsCollector.name);
  private intervalRef?: NodeJS.Timeout;

  constructor(
    private readonly dbConfig: DatabaseConfig,
    @InjectMetric('nodejs_memory_heap_used_bytes')
    private readonly heapUsed: Gauge<string>,
    @InjectMetric('nodejs_memory_rss_bytes')
    private readonly rss: Gauge<string>,
    @InjectMetric('db_connections_total')
    private readonly dbTotal: Gauge<string>,
    @InjectMetric('db_connections_idle')
    private readonly dbIdle: Gauge<string>,
  ) {}

  onApplicationBootstrap(): void {
    // Collect immediately, then on a 15-second cadence.
    void this.collect();
    this.intervalRef = setInterval(() => void this.collect(), 15_000);
    // Allow the process to exit even if the interval is still live.
    this.intervalRef.unref?.();
  }

  private async collect(): Promise<void> {
    try {
      // ── Memory ─────────────────────────────────────────────────────────────
      const mem = process.memoryUsage();
      this.heapUsed.set(mem.heapUsed);
      this.rss.set(mem.rss);

      // ── Database connection pool ───────────────────────────────────────────
      const stats = await this.dbConfig.queryPoolStats();
      this.dbTotal.set(stats.totalConnections);
      this.dbIdle.set(stats.idleConnections);
    } catch (err) {
      this.logger.warn(`Failed to collect metrics: ${(err as Error).message}`);
    }
  }
}

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PrometheusModule.register({
      // Serve metrics from our own controller (GET /metrics) and keep the
      // standard Node/process default metrics enabled.
      controller: MetricsController,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    // ── HTTP request metrics ─────────────────────────────────────────────────
    makeCounterProvider({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests, labelled by method, route and status code.',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeCounterProvider({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP requests that returned a 4xx/5xx response.',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, labelled by method, route and status code.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    }),

    // ── Memory metrics ────────────────────────────────────────────────────────
    makeGaugeProvider({
      name: 'nodejs_memory_heap_used_bytes',
      help: 'Node.js process heap memory currently in use (bytes).',
    }),
    makeGaugeProvider({
      name: 'nodejs_memory_rss_bytes',
      help: 'Node.js process resident set size — total memory allocated by the OS for the process (bytes).',
    }),

    // ── Database connection pool metrics ──────────────────────────────────────
    makeGaugeProvider({
      name: 'db_connections_total',
      help: 'Total number of open database connections (active + idle).',
    }),
    makeGaugeProvider({
      name: 'db_connections_idle',
      help: 'Number of idle database connections currently in the pool.',
    }),

    // ── Guards & interceptors ─────────────────────────────────────────────────
    MetricsIpGuard,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },

    // ── Metrics collector (drives periodic gauge updates) ─────────────────────
    MetricsCollector,
  ],
})
export class MetricsModule {}
