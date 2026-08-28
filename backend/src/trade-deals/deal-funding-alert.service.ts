import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { TradeDeal } from './entities/trade-deal.entity';
import { WebhooksService } from '../webhooks/webhooks.service';

/**
 * Milestones tracked as percentages of total deal value funded.
 * A notification is posted once when each threshold is first crossed.
 */
const FUNDING_MILESTONES = [25, 50, 75, 100] as const;
type FundingMilestone = (typeof FUNDING_MILESTONES)[number];

/**
 * DealFundingAlertService (#737, #804)
 *
 * Periodically checks all open trade deals and posts a Slack/Discord webhook
 * notification whenever a deal crosses a funding milestone (25%, 50%, 75%, or 100%).
 * Each milestone is reported only once per deal to avoid duplicate alerts.
 */
@Injectable()
export class DealFundingAlertService {
  private readonly logger = new Logger(DealFundingAlertService.name);

  /**
   * In-memory set of `${dealId}:${milestone}` keys that have already been
   * notified. Resets on process restart — acceptable because the webhook
   * messages are informational and occasional duplicates are harmless.
   */
  private readonly notified = new Set<string>();

  private readonly webhookUrl: string | undefined;

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly webhooksService?: WebhooksService,
  ) {
    this.webhookUrl =
      this.configService.get<string>('SLACK_WEBHOOK_URL') ||
      this.configService.get<string>('DISCORD_WEBHOOK_URL') ||
      this.configService.get<string>('ALERT_WEBHOOK_URL');

    if (!this.webhookUrl) {
      this.logger.warn(
        'No webhook URL configured (SLACK_WEBHOOK_URL / DISCORD_WEBHOOK_URL / ALERT_WEBHOOK_URL). ' +
          'Funding progress alerts will only be logged.',
      );
    }
  }

  /**
   * Checks open/funded deals every 5 minutes.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkFundingMilestones(): Promise<void> {
    try {
      // Fetch all deals that are still accepting investment or just became funded
      const deals = await this.tradeDealRepo.find({
        where: [{ status: 'open' }, { status: 'funded' }],
      });

      for (const deal of deals) {
        await this.evaluateDeal(deal);
      }
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to check deal funding milestones',
      );
    }
  }

  /**
   * Evaluate a single deal and fire alerts for any newly crossed milestones.
   * Called from the cron job, but also exposed so that the InvestmentsService
   * can trigger an immediate check after a new investment is confirmed.
   */
  async evaluateDeal(deal: TradeDeal): Promise<void> {
    const totalValue = Number(deal.totalValue);
    if (totalValue <= 0) return;

    const totalInvested = Number(deal.totalInvested);
    const pct = (totalInvested / totalValue) * 100;

    for (const milestone of FUNDING_MILESTONES) {
      const key = `${deal.id}:${milestone}`;
      if (pct >= milestone && !this.notified.has(key)) {
        this.notified.add(key);
        await this.sendAlert(deal, milestone, pct);
      }
    }
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private async sendAlert(
    deal: TradeDeal,
    milestone: FundingMilestone,
    actualPct: number,
  ): Promise<void> {
    const emoji = milestone === 100 ? '🎉' : '🚀';
    const label =
      milestone === 100
        ? 'fully funded'
        : `${milestone}% funded`;
    const message =
      `${emoji} *Deal ${deal.tokenSymbol}* (${deal.commodity}) is now *${label}*! ` +
      `Raised $${Number(deal.totalInvested).toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
      `of $${Number(deal.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })} ` +
      `(${actualPct.toFixed(1)}%).`;

    this.logger.log(
      { dealId: deal.id, milestone, actualPct },
      message,
    );

    if (this.webhooksService) {
      try {
        await this.webhooksService.dispatchFundingProgress(deal, milestone, actualPct);
      } catch (webhookErr) {
        this.logger.error(
          { err: webhookErr, dealId: deal.id, milestone },
          'Failed to dispatch signed external webhook',
        );
      }
    }

    if (!this.webhookUrl) return;

    try {
      // Compatible with both Slack incoming-webhooks and Discord webhooks.
      // Slack uses `text`; Discord uses `content`.
      const payload = { text: message, content: message };
      await firstValueFrom(this.httpService.post(this.webhookUrl, payload));
      this.logger.log(
        { dealId: deal.id, milestone },
        `Webhook alert sent for deal ${deal.tokenSymbol} at ${milestone}% milestone`,
      );
    } catch (err) {
      this.logger.error(
        { err, dealId: deal.id, milestone },
        'Failed to send funding progress webhook alert',
      );
    }
  }
}

