import { Injectable, OnModuleInit } from '@nestjs/common';
import { register, Gauge, Counter } from 'prom-client';
import { HorizonFailoverClient } from './horizon-failover';

/**
 * Prometheus metrics for Stellar Horizon failover cluster monitoring.
 *
 * Exported metrics:
 * - stellar_horizon_active_node_latency_ms: Gauge of active node latency
 * - stellar_horizon_node_status: Gauge (1=healthy, 0=unhealthy) per node
 * - stellar_horizon_failover_count: Counter of failover events
 */
@Injectable()
export class StellarPrometheusService implements OnModuleInit {
  private activeNodeLatencyGauge: Gauge<'node'>;
  private nodeStatusGauge: Gauge<'node'>;
  private failoverCountCounter: Counter;

  constructor(private horizonClient: HorizonFailoverClient) {}

  onModuleInit() {
    // Gauge: Active node latency in milliseconds
    this.activeNodeLatencyGauge = new Gauge({
      name: 'stellar_horizon_active_node_latency_ms',
      help: 'Latency of the currently active Horizon node in milliseconds',
      labelNames: ['node'],
      registers: [register],
    });

    // Gauge: Node health status (1 = healthy, 0 = unhealthy)
    this.nodeStatusGauge = new Gauge({
      name: 'stellar_horizon_node_status',
      help: 'Health status of each Horizon node (1=healthy, 0=unhealthy)',
      labelNames: ['node', 'url'],
      registers: [register],
    });

    // Counter: Failover events (incremented each time we switch nodes)
    this.failoverCountCounter = new Counter({
      name: 'stellar_horizon_failover_count',
      help: 'Total number of Horizon node failover events',
      labelNames: ['from_node', 'to_node'],
      registers: [register],
    });

    // Initialize all nodes as healthy (1.0) in metrics
    const nodeStatuses = this.horizonClient.getNodeHealth();
    for (const status of nodeStatuses) {
      this.nodeStatusGauge.set({ node: status.url, url: status.url }, status.healthy ? 1 : 0);
    }
  }

  /**
   * Update active node latency metric.
   * Called after each successful Horizon operation.
   */
  recordActiveNodeLatency(latencyMs: number): void {
    const activeNode = this.horizonClient.activeUrl;
    this.activeNodeLatencyGauge.set({ node: activeNode }, latencyMs);
  }

  /**
   * Update node health status metrics.
   * Call this periodically or after health checks.
   */
  updateNodeStatus(): void {
    const nodeStatuses = this.horizonClient.getNodeHealth();
    for (const status of nodeStatuses) {
      this.nodeStatusGauge.set(
        { node: status.url, url: status.url },
        status.healthy ? 1 : 0,
      );
    }
  }

  /**
   * Record a failover event.
   */
  recordFailover(fromNode: string, toNode: string): void {
    this.failoverCountCounter.inc({ from_node: fromNode, to_node: toNode });
  }

  /**
   * Get current metric values for debugging.
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
