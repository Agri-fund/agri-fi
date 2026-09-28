import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { RedisClientType } from 'redis';

/**
 * Health indicator for Redis connection.
 * Checks if the Redis client is connected and can execute a PING command.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisClientType | null) {
    super();
  }

  /**
   * Check Redis health by sending a PING command.
   * @param key  The key name used in the health-check response (e.g. "redis").
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.redis) {
      // Redis is not configured - treat as healthy (optional dependency)
      return this.getStatus(key, true, {
        message: 'Redis not configured',
      });
    }

    try {
      const result = await this.redis.ping();
      if (result === 'PONG') {
        return this.getStatus(key, true);
      }
      throw new Error('Redis ping did not return PONG');
    } catch (err: unknown) {
      const details = {
        message:
          err instanceof Error ? err.message : 'Redis connection failed',
      };
      throw new HealthCheckError(
        `${key} health check failed`,
        this.getStatus(key, false, details),
      );
    }
  }
}
