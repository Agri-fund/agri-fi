import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';
import { QUEUE_SERVICE } from '../queue/queue.constants';

/**
 * Verifies the health of the live RabbitMQ ClientProxy connection used by
 * QueueService. Calling `client.connect()` on an amqp-connection-manager
 * ClientProxy resolves immediately when the underlying channel is ready and
 * rejects (or times out) when the broker is unreachable.
 *
 * This is preferable to MicroserviceHealthIndicator.pingCheck, which opens a
 * brand-new transient TCP connection on every poll and therefore cannot detect
 * that the application's own publishing channel has gone away.
 */
@Injectable()
export class RabbitmqHealthIndicator extends HealthIndicator {
  private static readonly PROBE_TIMEOUT_MS = 3_000;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly client: ClientProxy,
  ) {
    super();
  }

  /**
   * @param key  The key name used in the health-check response (e.g. "rabbitmq").
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // connect() returns an Observable that emits once the connection is
      // established. We convert it to a Promise and apply a hard timeout so a
      // stalled broker does not block the /health endpoint indefinitely.
      await lastValueFrom(
        of(this.client.connect()).pipe(
          timeout(RabbitmqHealthIndicator.PROBE_TIMEOUT_MS),
          catchError((err) => {
            throw err;
          }),
        ),
      );

      return this.getStatus(key, true);
    } catch (err: unknown) {
      const details = {
        message:
          err instanceof Error ? err.message : 'RabbitMQ connection failed',
      };
      throw new HealthCheckError(
        `${key} health check failed`,
        this.getStatus(key, false, details),
      );
    }
  }
}
