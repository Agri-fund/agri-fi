import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { createHmac, randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
} from './dto/create-webhook-subscription.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    private readonly httpService: HttpService,
  ) {}

  async createSubscription(
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription> {
    const secret = dto.secret || randomBytes(32).toString('hex');
    const sub = this.subscriptionRepo.create({
      url: dto.url,
      secret,
      events: dto.events,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });
    return await this.subscriptionRepo.save(sub);
  }

  async findAllSubscriptions(): Promise<WebhookSubscription[]> {
    return await this.subscriptionRepo.find();
  }

  async findOneSubscription(id: string): Promise<WebhookSubscription> {
    const sub = await this.subscriptionRepo.findOne({ where: { id } });
    if (!sub) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }
    return sub;
  }

  async updateSubscription(
    id: string,
    dto: UpdateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription> {
    const sub = await this.findOneSubscription(id);
    Object.assign(sub, dto);
    return await this.subscriptionRepo.save(sub);
  }

  async deleteSubscription(id: string): Promise<void> {
    const sub = await this.findOneSubscription(id);
    await this.subscriptionRepo.remove(sub);
  }

  /**
   * Generates HMAC-SHA256 signature for payload string using secret.
   * Matches WebhookSignatureGuard pattern (x-webhook-signature header).
   */
  generateSignature(payloadString: string, secret: string): string {
    return createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  /**
   * Dispatches deal.funding_progress event to all active subscribers.
   */
  async dispatchFundingProgress(
    deal: TradeDeal,
    milestone: number,
    actualPct: number,
  ): Promise<void> {
    const subscriptions = await this.subscriptionRepo.find({
      where: { isActive: true },
    });

    const eventSubscribers = subscriptions.filter(
      (sub) =>
        sub.events.includes('deal.funding_progress') ||
        sub.events.includes('*'),
    );

    if (eventSubscribers.length === 0) {
      return;
    }

    const payloadObj = {
      event: 'deal.funding_progress',
      timestamp: new Date().toISOString(),
      data: {
        dealId: deal.id,
        tokenSymbol: deal.tokenSymbol,
        commodity: deal.commodity,
        totalValue: Number(deal.totalValue),
        totalInvested: Number(deal.totalInvested),
        milestone,
        actualPercentage: Number(actualPct.toFixed(2)),
        status: deal.status,
      },
    };

    const payloadString = JSON.stringify(payloadObj);

    for (const sub of eventSubscribers) {
      await this.sendPayloadWithRetry(sub, payloadString);
    }
  }

  /**
   * Sends HTTP POST request to webhook URL with HMAC-SHA256 signature and exponential back-off.
   */
  async sendPayloadWithRetry(
    sub: WebhookSubscription,
    payloadString: string,
    maxAttempts = 3,
  ): Promise<boolean> {
    const signature = this.generateSignature(payloadString, sub.secret);
    const headers = {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(sub.url, payloadString, {
            headers,
            timeout: 5000,
          }),
        );

        if (response.status >= 200 && response.status < 300) {
          this.logger.log(
            `Successfully delivered webhook to ${sub.url} on attempt ${attempt}`,
          );
          return true;
        }
      } catch (err: any) {
        const statusCode = err?.response?.status;
        this.logger.warn(
          `Webhook delivery to ${sub.url} failed (attempt ${attempt}/${maxAttempts}): ${statusCode || err?.message}`,
        );

        if (attempt < maxAttempts) {
          const delayMs = 500 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.error(
      `Failed to deliver webhook to ${sub.url} after ${maxAttempts} attempts`,
    );
    return false;
  }
}
