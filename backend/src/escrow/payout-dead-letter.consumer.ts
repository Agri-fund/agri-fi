import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueAlertService } from '../queue/queue-alert.service';
import { ConfigService } from '@nestjs/config';

/**
 * Shape mirroring whatever the escrow consumer placed on the queue.
 * x-death headers are injected by RabbitMQ and available as message metadata.
 */
interface DlqMessage {
  tradeDealId?: string;
  [key: string]: unknown;
}

/**
 * Consumes messages that have exhausted all broker-level retries and been
 * routed to agric_onchain_escrow_queue.dlq.
 *
 * Responsibilities:
 *  1. Log a structured error entry with full message details.
 *  2. Send an alert email to the platform ops address.
 *  3. Fire a Discord webhook via QueueAlertService for immediate visibility.
 *  4. Ack the DLQ message so it is not redelivered (manual reprocessing is
 *     out-of-band and should be triggered by the engineer after investigation).
 */
@Controller()
export class PayoutDeadLetterConsumer {
  private readonly logger = new Logger(PayoutDeadLetterConsumer.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly queueAlertService: QueueAlertService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * RabbitMQ delivers DLQ messages without a routing key (the DLX is a fanout
   * exchange), so we listen on an empty-string pattern which NestJS RMQ
   * transport maps to the queue's default binding.
   */
  @EventPattern('')
  async handleDeadLetter(
    @Payload() payload: DlqMessage,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    const tradeDealId = payload?.tradeDealId ?? 'unknown';
    const xDeath = originalMsg?.properties?.headers?.['x-death'];
    const totalAttempts = Array.isArray(xDeath)
      ? xDeath.reduce(
          (sum: number, d: { count?: number }) => sum + (d.count ?? 0),
          0,
        )
      : 'unknown';

    this.logger.error(
      {
        tradeDealId,
        totalAttempts,
        payload,
        xDeath,
      },
      `[DLQ] Escrow release permanently failed for deal ${tradeDealId} after ${totalAttempts} attempts. Manual intervention required.`,
    );

    // Notify the operations team via email and Discord in parallel so a single
    // channel failure does not block the other.
    await Promise.allSettled([
      this.sendOpsEmail(tradeDealId, totalAttempts, payload),
      this.sendDiscordAlert(tradeDealId, totalAttempts),
    ]);

    // Ack so the DLQ does not grow unbounded. The logged details and
    // notifications give engineers enough context to replay manually.
    channel.ack(originalMsg);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async sendOpsEmail(
    tradeDealId: string,
    totalAttempts: number | string,
    payload: DlqMessage,
  ): Promise<void> {
    const opsEmail = this.configService.get<string>('OPS_ALERT_EMAIL');
    if (!opsEmail) {
      this.logger.warn(
        'OPS_ALERT_EMAIL not configured — skipping ops email notification',
      );
      return;
    }

    const subject = `[AGRI-FI ALERT] Escrow release failed — Deal ${tradeDealId}`;
    const text =
      `The escrow release for deal ${tradeDealId} has permanently failed after ` +
      `${totalAttempts} delivery attempts and has been routed to the Dead Letter Queue.\n\n` +
      `Payload:\n${JSON.stringify(payload, null, 2)}\n\n` +
      `Please investigate and replay the message manually if appropriate.`;
    const html =
      `<h2>⚠️ Escrow Release Failure — Manual Intervention Required</h2>` +
      `<p>The escrow release for deal <strong>${tradeDealId}</strong> has permanently failed after ` +
      `<strong>${totalAttempts}</strong> delivery attempts and has been routed to the Dead Letter Queue.</p>` +
      `<h3>Message Payload</h3>` +
      `<pre>${JSON.stringify(payload, null, 2)}</pre>` +
      `<p>Please investigate and replay the message manually if appropriate.</p>`;

    try {
      await this.notificationsService.sendEmail(opsEmail, subject, text, html);
      this.logger.log(`DLQ ops alert email dispatched for deal ${tradeDealId}`);
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        `Failed to send DLQ ops alert email for deal ${tradeDealId}`,
      );
    }
  }

  private async sendDiscordAlert(
    tradeDealId: string,
    totalAttempts: number | string,
  ): Promise<void> {
    try {
      await this.queueAlertService.sendAlert(
        `🚨 DLQ Alert: Escrow release for deal \`${tradeDealId}\` permanently failed after ` +
          `${totalAttempts} attempts. The message has been routed to ` +
          `\`agric_onchain_escrow_queue.dlq\`. **Manual intervention required.**`,
      );
      this.logger.log(`DLQ Discord alert dispatched for deal ${tradeDealId}`);
    } catch (err: any) {
      this.logger.warn(
        { error: err.message },
        `Failed to send DLQ Discord alert for deal ${tradeDealId}`,
      );
    }
  }
}
