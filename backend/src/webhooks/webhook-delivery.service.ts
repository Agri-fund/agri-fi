import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LessThanOrEqual, In, Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from './entities/webhook-delivery.entity';
import { nextRetryDelayMs } from './webhook-retry';

const BATCH_SIZE = 50;
/** Held by a worker while it delivers, so other replicas skip the row. */
const CLAIM_LEASE_MS = 2 * 60_000;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;

/**
 * Durable webhook delivery: every event becomes a `webhook_deliveries` row that
 * is retried with exponential backoff until it succeeds or lands in the dead
 * letter queue (`status = 'failed'`), from where it can be replayed.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  /** Per-instance sliding window of send timestamps, keyed by subscription. */
  private readonly sendLog = new Map<string, number[]>();

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /** Creates a delivery for each active subscriber of `event` and sends it. */
  async enqueue(event: string, data: Record<string, unknown>): Promise<void> {
    const subs = await this.subscriptionRepo.find({
      where: { isActive: true },
    });
    const targets = subs.filter(
      (s) => s.events.includes(event) || s.events.includes('*'),
    );
    if (targets.length === 0) return;

    const payload = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data,
    });
    const deliveries = await this.deliveryRepo.save(
      targets.map((s) =>
        this.deliveryRepo.create({
          subscriptionId: s.id,
          event,
          payload,
          status: 'pending',
          attemptCount: 0,
          nextAttemptAt: new Date(),
          attempts: [],
        }),
      ),
    );
    await Promise.allSettled(deliveries.map((d) => this.attempt(d)));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<number> {
    const due = await this.deliveryRepo.find({
      where: {
        status: In(['pending', 'retrying']),
        nextAttemptAt: LessThanOrEqual(new Date()),
      },
      order: { nextAttemptAt: 'ASC' },
      take: BATCH_SIZE,
    });
    let processed = 0;
    for (const delivery of due) {
      // Atomically push nextAttemptAt out; only the replica that wins sends.
      const claim = await this.deliveryRepo.update(
        { id: delivery.id, nextAttemptAt: delivery.nextAttemptAt as Date },
        { nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) },
      );
      if (!claim.affected) continue;
      await this.attempt(delivery);
      processed++;
    }
    return processed;
  }

  /** Performs one HTTP delivery attempt and updates status and the attempt log. */
  async attempt(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    const sub = await this.subscriptionRepo.findOne({
      where: { id: delivery.subscriptionId },
    });
    if (!sub || !sub.isActive) {
      return this.finish(delivery, 'failed', {
        error: 'Subscription deleted or inactive',
      });
    }

    if (this.isRateLimited(sub.id)) {
      delivery.nextAttemptAt = new Date(Date.now() + RATE_WINDOW_MS);
      return this.deliveryRepo.save(delivery);
    }

    const started = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await firstValueFrom(
        this.httpService.post(sub.url, delivery.payload, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': this.sign(delivery.payload, sub.secret),
            'x-webhook-event': delivery.event,
            'x-webhook-delivery': delivery.id,
          },
        }),
      );
      statusCode = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err: any) {
      statusCode = err?.response?.status ?? null;
      error = statusCode ? `HTTP ${statusCode}` : (err?.message ?? 'Error');
    }

    delivery.attemptCount += 1;
    delivery.attempts = [
      ...delivery.attempts,
      {
        attempt: delivery.attemptCount,
        at: new Date().toISOString(),
        statusCode,
        error,
        durationMs: Date.now() - started,
      },
    ];

    if (!error) {
      delivery.deliveredAt = new Date();
      return this.finish(delivery, 'delivered', { statusCode });
    }

    const delay = nextRetryDelayMs(delivery.attemptCount);
    if (delay === null) {
      this.logger.error(
        `Webhook ${delivery.id} moved to DLQ after ${delivery.attemptCount} attempts`,
      );
      return this.finish(delivery, 'failed', { statusCode, error });
    }
    delivery.status = 'retrying';
    delivery.nextAttemptAt = new Date(Date.now() + delay);
    delivery.lastStatusCode = statusCode;
    delivery.lastError = error;
    return this.deliveryRepo.save(delivery);
  }

  async listForSubscription(
    subscriptionId: string,
    status?: WebhookDeliveryStatus,
    limit = 50,
  ): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { subscriptionId, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** Dead letter queue: deliveries that exhausted their retries. */
  async listDeadLetters(limit = 50): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { status: 'failed' },
      order: { updatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** Dashboard summary for one subscription. */
  async summary(subscriptionId: string) {
    const rows = await this.deliveryRepo
      .createQueryBuilder('d')
      .select('d.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(d.updated_at)', 'lastActivity')
      .where('d.subscription_id = :subscriptionId', { subscriptionId })
      .groupBy('d.status')
      .getRawMany<{ status: string; count: string; lastActivity: Date }>();
    const counts = { pending: 0, retrying: 0, delivered: 0, failed: 0 };
    for (const r of rows) counts[r.status as keyof typeof counts] = +r.count;
    return counts;
  }

  /** Manual retry of a dead-lettered delivery. The attempt log is kept. */
  async replay(id: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({ where: { id } });
    if (!delivery) throw new NotFoundException(`Delivery ${id} not found`);
    if (delivery.status !== 'failed') {
      throw new BadRequestException('Only failed deliveries can be replayed');
    }
    delivery.status = 'pending';
    delivery.attemptCount = 0;
    delivery.nextAttemptAt = new Date();
    delivery.lastError = null;
    await this.deliveryRepo.save(delivery);
    return this.attempt(delivery);
  }

  private isRateLimited(subscriptionId: string): boolean {
    const limit = Number(
      this.config.get('WEBHOOK_RATE_LIMIT_PER_MIN', DEFAULT_RATE_LIMIT_PER_MIN),
    );
    const now = Date.now();
    const recent = (this.sendLog.get(subscriptionId) ?? []).filter(
      (t) => now - t < RATE_WINDOW_MS,
    );
    if (recent.length >= limit) {
      this.sendLog.set(subscriptionId, recent);
      return true;
    }
    recent.push(now);
    this.sendLog.set(subscriptionId, recent);
    return false;
  }

  private finish(
    delivery: WebhookDelivery,
    status: WebhookDeliveryStatus,
    info: { statusCode?: number | null; error?: string | null },
  ): Promise<WebhookDelivery> {
    delivery.status = status;
    delivery.nextAttemptAt = null;
    delivery.lastStatusCode = info.statusCode ?? null;
    delivery.lastError = info.error ?? null;
    return this.deliveryRepo.save(delivery);
  }
}
