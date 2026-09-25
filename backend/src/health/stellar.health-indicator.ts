import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { HorizonFailoverClient } from '../stellar/horizon-failover';

export interface StellarHealthDetails {
  activeNode: {
    url: string;
    latencyMs?: number;
  };
  nodes: Array<{
    url: string;
    healthy: boolean;
    latencyMs?: number;
    lastError?: string;
    checkedAt: string;
  }>;
  allNodesHealthy: boolean;
  anyNodeHealthy: boolean;
}

/**
 * Health indicator for Stellar Horizon failover cluster.
 * Checks the current active node and reports status of all fallback nodes.
 */
@Injectable()
export class StellarHealthIndicator extends HealthIndicator {
  constructor(private horizonClient: HorizonFailoverClient) {
    super();
  }

  /**
   * Check Stellar Horizon node health without triggering failover.
   * Returns current active node and status of all nodes.
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const nodeStatuses = this.horizonClient.getNodeHealth();
    const activeUrl = this.horizonClient.activeUrl;
    const activeLatency = this.horizonClient.getActiveNodeLatency();
    const allUnhealthy = this.horizonClient.areAllNodesUnhealthy();
    const anyHealthy = nodeStatuses.some((n) => n.healthy);

    const details: StellarHealthDetails = {
      activeNode: {
        url: activeUrl,
        latencyMs: activeLatency,
      },
      nodes: nodeStatuses.map((status) => ({
        url: status.url,
        healthy: status.healthy,
        latencyMs: status.lastLatencyMs,
        lastError: status.lastError,
        checkedAt: status.checkedAt.toISOString(),
      })),
      allNodesHealthy: nodeStatuses.every((n) => n.healthy),
      anyNodeHealthy: anyHealthy,
    };

    // Return unhealthy if all nodes are down (critical failure)
    if (allUnhealthy) {
      throw new HealthCheckError('Stellar Horizon: All nodes unreachable', {
        stellar: {
          status: 'down',
          details,
        },
      });
    }

    // Return degraded if any node is down (warning)
    if (!nodeStatuses.every((n) => n.healthy)) {
      return this.getStatus(key, false, {
        stellar: {
          status: 'degraded',
          details,
        },
      });
    }

    // All healthy
    return this.getStatus(key, true, {
      stellar: {
        status: 'up',
        details,
      },
    });
  }

  /**
   * Perform active health checks on all Horizon nodes.
   * Should be called periodically or on demand, not on every request.
   */
  async checkAllNodes(key: string): Promise<HealthIndicatorResult> {
    const nodeStatuses = await this.horizonClient.checkAllNodesHealth();
    const activeUrl = this.horizonClient.activeUrl;
    const activeLatency = this.horizonClient.getActiveNodeLatency();
    const allUnhealthy = this.horizonClient.areAllNodesUnhealthy();
    const anyHealthy = nodeStatuses.some((n) => n.healthy);

    const details: StellarHealthDetails = {
      activeNode: {
        url: activeUrl,
        latencyMs: activeLatency,
      },
      nodes: nodeStatuses.map((status) => ({
        url: status.url,
        healthy: status.healthy,
        latencyMs: status.lastLatencyMs,
        lastError: status.lastError,
        checkedAt: status.checkedAt.toISOString(),
      })),
      allNodesHealthy: nodeStatuses.every((n) => n.healthy),
      anyNodeHealthy: anyHealthy,
    };

    if (allUnhealthy) {
      throw new HealthCheckError('Stellar Horizon: All nodes unreachable', {
        stellar: {
          status: 'down',
          details,
        },
      });
    }

    if (!nodeStatuses.every((n) => n.healthy)) {
      return this.getStatus(key, false, {
        stellar: {
          status: 'degraded',
          details,
        },
      });
    }

    return this.getStatus(key, true, {
      stellar: {
        status: 'up',
        details,
      },
    });
  }
}
