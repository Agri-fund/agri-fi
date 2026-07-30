import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Service that periodically checks the RabbitMQ queue size via the management HTTP API.
 * If the number of ready messages stays above a threshold for a configured duration,
 * a Discord webhook notification is sent.
 */
@Injectable()
export class QueueAlertService {
  private readonly logger = new Logger(QueueAlertService.name);

  // In‑memory tracking of when the high‑water mark was first observed.
  private highWaterStart: Date | null = null;

  // Configuration defaults – can be overridden via environment variables.
  private readonly threshold = Number(
    this.configService.get<string>('QUEUE_ALERT_THRESHOLD', '10'),
  );
  private readonly durationMs = Number(
    this.configService.get<string>(
      'QUEUE_ALERT_DURATION_MS',
      `${5 * 60 * 1000}`,
    ),
  ); // 5 minutes
  private readonly webhookUrl = this.configService.get<string>(
    'DISCORD_WEBHOOK_URL',
  );

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Runs every minute. Adjust the cron expression if you need a different interval.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async monitorQueue(): Promise<void> {
    try {
      const apiUrl = this.buildManagementApiUrl();
      const response = await firstValueFrom(
        this.httpService.get(apiUrl, { auth: this.buildAuth() }),
      );
      const queueInfo = response.data as {
        messages: number;
        idle_since?: string;
      };
      const readyCount = queueInfo.messages;

      this.logger.debug(`Queue ready messages: ${readyCount}`);

      if (readyCount > this.threshold) {
        if (!this.highWaterStart) {
          this.highWaterStart = new Date();
          this.logger.warn(
            `Queue size exceeded threshold (${this.threshold}). Monitoring started.`,
          );
        } else if (
          new Date().getTime() - this.highWaterStart.getTime() >=
          this.durationMs
        ) {
          await this.sendDiscordAlert(readyCount);
          // Reset after notification to avoid spamming.
          this.highWaterStart = null;
        }
      } else {
        // Queue back to normal – reset monitoring.
        if (this.highWaterStart) {
          this.logger.log('Queue size back under threshold; monitoring reset.');
        }
        this.highWaterStart = null;
      }
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to query RabbitMQ management API for queue metrics',
      );
    }
  }

  private buildManagementApiUrl(): string {
    const host = this.configService.get<string>(
      'RABBITMQ_MANAGEMENT_HOST',
      'localhost',
    );
    const port = this.configService.get<string>(
      'RABBITMQ_MANAGEMENT_PORT',
      '15672',
    );
    const vhost = encodeURIComponent(
      this.configService.get<string>('RABBITMQ_VHOST', '/'),
    );
    const queue = encodeURIComponent(
      this.configService.get<string>(
        'RABBITMQ_QUEUE_NAME',
        'agric_onchain_queue',
      ),
    );
    return `http://${host}:${port}/api/queues/${vhost}/${queue}`;
  }

  private buildAuth(): { username: string; password: string } | undefined {
    const user = this.configService.get<string>('RABBITMQ_USER');
    const pass = this.configService.get<string>('RABBITMQ_PASSWORD');
    return user && pass ? { username: user, password: pass } : undefined;
  }

  /**
   * Send an arbitrary message to the configured Discord webhook.
   * Used both by the queue-backlog monitor and by DLQ consumers that need
   * to notify engineers of permanently failed messages.
   */
  async sendAlert(message: string): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn('DISCORD_WEBHOOK_URL not configured – alert not sent');
      return;
    }
    try {
      await firstValueFrom(
        this.httpService.post(this.webhookUrl, { content: message }),
      );
      this.logger.log('Discord alert sent');
    } catch (err) {
      this.logger.error({ err }, 'Failed to send Discord webhook notification');
    }
  }

  private async sendDiscordAlert(currentCount: number): Promise<void> {
    await this.sendAlert(
      `⚠️ Queue **${this.configService.get<string>(
        'RABBITMQ_QUEUE_NAME',
        'agric_onchain_queue',
      )}** has been above **${this.threshold}** messages for over **5 minutes**. Current ready messages: ${currentCount}.`,
    );
  }
}
