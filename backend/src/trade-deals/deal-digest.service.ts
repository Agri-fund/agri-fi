import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, MoreThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { RedisConfig } from '../config/redis.config';
import { RedisClientType } from 'redis';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { Document } from './entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-template.service';

/** Deal statuses included in the weekly digest. */
const ACTIVE_DEAL_STATUSES = ['open', 'funded', 'delivered'] as const;

/** Investment statuses counted toward weekly funding pace metrics (#1021). */
const COUNTED_INVESTMENT_STATUSES = new Set<string>([
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.COMPLETED,
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DigestAggregation {
  deals: TradeDeal[];
  newInvestments: Investment[];
  upcomingMilestones: TradeDeal[];
  loggedMilestones: ShipmentMilestone[];
  missingDocs: TradeDeal[];
  fundingPacePct: number;
  investorTotal: number;
}

/**
 * #1021 / #892 — Weekly deal digest for farmers.
 *
 * Every opted-in farmer receives one localized email per week summarizing
 * their active deals: funding pace, milestones due/logged, deposits, and
 * derived action items. Sent Monday 07:00 in the farmer's timezone,
 * deduplicated per ISO week.
 */
@Injectable()
export class DealDigestService implements OnModuleInit, OnModuleDestroy {
  private redisClient: RedisClientType | null = null;
  /** In-memory dedupe fallback when Redis is not configured. */
  private readonly sentThisRun = new Set<string>();

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    private readonly notificationsService: NotificationsService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly redisConfig: RedisConfig,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DealDigestService.name);
  }

  async onModuleInit(): Promise<void> {
    this.redisClient = await this.redisConfig.createClient();
    if (this.redisClient && !this.redisClient.isOpen) {
      try {
        await this.redisClient.connect();
      } catch (err: any) {
        this.logger.warn(
          { error: err.message },
          'Failed to connect Redis client for digest dedupe',
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  /**
   * Pure aggregation helpers exposed for unit tests (#1021).
   */
  aggregateDigestData(input: {
    deals: TradeDeal[];
    investments: Investment[];
    documents: Array<{ tradeDealId: string }>;
    milestones: ShipmentMilestone[];
    since: Date;
    now?: Date;
  }): DigestAggregation {
    const now = input.now?.getTime() ?? Date.now();
    const since = input.since.getTime();

    const newInvestments = input.investments.filter((inv) => {
      const created = inv.createdAt ? new Date(inv.createdAt).getTime() : 0;
      const statusOk =
        !inv.status || COUNTED_INVESTMENT_STATUSES.has(String(inv.status));
      return created >= since && statusOk;
    });

    const dealsWithDocs = new Set(input.documents.map((d) => d.tradeDealId));
    const upcomingMilestones = input.deals.filter(
      (d) =>
        d.deliveryDate &&
        now < new Date(d.deliveryDate).getTime() &&
        new Date(d.deliveryDate).getTime() <= now + 7 * MS_PER_DAY,
    );
    const missingDocs = input.deals.filter(
      (d) => !dealsWithDocs.has(d.id) && d.status === 'open',
    );

    const loggedMilestones = input.milestones.filter((m) => {
      const recorded = m.recordedAt ? new Date(m.recordedAt).getTime() : 0;
      return recorded >= since;
    });

    const totalValue = input.deals.reduce(
      (sum, d) => sum + Number(d.totalValue ?? 0),
      0,
    );
    const totalInvested = input.deals.reduce(
      (sum, d) => sum + Number(d.totalInvested ?? 0),
      0,
    );
    const fundingPacePct =
      totalValue > 0 ? Math.round((totalInvested / totalValue) * 100) : 0;

    const investorTotal = newInvestments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd ?? 0),
      0,
    );

    return {
      deals: input.deals,
      newInvestments,
      upcomingMilestones,
      loggedMilestones,
      missingDocs,
      fundingPacePct,
      investorTotal,
    };
  }

  /**
   * Builds the full digest payload for one farmer.
   * Returns null when there is nothing to send (no active deals or the
   * farmer opted out).
   */
  async generateForFarmer(
    userId: string,
  ): Promise<{ subject: string; html: string; text: string } | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    // Explicit opt-in respected (#1021)
    if (!user || user.emailDigestEnabled === false) return null;

    const deals = await this.tradeDealRepo.find({
      where: { farmerId: userId, status: In([...ACTIVE_DEAL_STATUSES]) },
    });
    if (deals.length === 0) return null;

    const dealIds = deals.map((d) => d.id);
    const since = new Date(Date.now() - 7 * MS_PER_DAY);

    const allInvestments = await this.investmentRepo.find({
      where: { tradeDealId: In(dealIds) },
      relations: ['investor'],
    });

    const docs = await this.documentRepo.find({
      where: { tradeDealId: In(dealIds) },
      select: ['tradeDealId'],
    });

    const milestones = await this.milestoneRepo.find({
      where: {
        tradeDealId: In(dealIds),
        recordedAt: MoreThanOrEqual(since),
      },
    });

    const agg = this.aggregateDigestData({
      deals,
      investments: allInvestments,
      documents: docs,
      milestones,
      since,
    });

    const headings = this.emailTemplates.getSectionHeadings(
      user.preferredLanguage,
    );

    const dealsHtml = deals.map((deal) => this.renderDealRow(deal)).join('');
    const chartSvg = this.renderFundingChart(deals);

    const milestonesHtml =
      agg.upcomingMilestones.length > 0 || agg.loggedMilestones.length > 0
        ? `<ul>${[
            ...agg.upcomingMilestones.map(
              (d) =>
                `<li>Due: ${escapeHtml(d.commodity)} — ${escapeHtml(
                  String(d.deliveryDate).slice(0, 10),
                )}</li>`,
            ),
            ...agg.loggedMilestones.map(
              (m) =>
                `<li>Logged: ${escapeHtml(m.milestone)} (${escapeHtml(
                  String(m.recordedAt).slice(0, 10),
                )})</li>`,
            ),
          ].join('')}</ul>`
        : '<p>No milestones scheduled or logged for the next 7 days.</p>';

    const documentsHtml =
      agg.missingDocs.length > 0
        ? `<ul>${agg.missingDocs
            .map(
              (d) =>
                `<li>${escapeHtml(d.commodity)} (${escapeHtml(d.tokenSymbol)})</li>`,
            )
            .join('')}</ul>`
        : '<p>All required documents have been submitted.</p>';

    const actionsHtml = this.buildActionItems(
      deals,
      agg.missingDocs,
      agg.newInvestments,
    );

    const weekStart = new Date(Date.now() - 7 * MS_PER_DAY);
    const fmt = (date: Date) => date.toISOString().slice(0, 10);

    const vars: Record<string, unknown> = {
      farmerName: user.fullName || user.email.split('@')[0],
      weekRange: `${fmt(weekStart)} → ${fmt(new Date())}`,
      newInvestorCount: String(agg.newInvestments.length),
      newInvestorTotal: agg.investorTotal.toLocaleString('en-US'),
      fundingPacePct: String(agg.fundingPacePct),
      milestonesLoggedCount: String(agg.loggedMilestones.length),
      milestonesDueCount: String(agg.upcomingMilestones.length),
      sectionDeals: headings.deals,
      sectionMilestones: headings.milestones,
      sectionDocuments: headings.documents,
      sectionActions: headings.actions,
      unsubscribeLabel: headings.unsubscribe,
      unsubscribeUrl: this.unsubscribeUrl(user.id),
      chartSvg,
      dealsHtml,
      milestonesHtml,
      documentsHtml,
      actionsHtml,
    };

    return this.emailTemplates.render(
      'deal-digest',
      vars,
      user.preferredLanguage,
    );
  }

  /**
   * Hourly scheduler: sends the digest to every opted-in farmer for whom it
   * is currently Monday 07:00 local time, once per ISO week (#1021).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runWeeklyDigest(): Promise<void> {
    let candidates: User[] = [];
    try {
      candidates = await this.userRepo.find({
        where: { role: 'farmer', emailDigestEnabled: true as any },
      });
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Digest scheduler could not load farmers',
      );
      return;
    }

    for (const user of candidates) {
      if (!this.isMondaySevenLocal(user.timezone)) continue;

      const key = `digest:sent:${user.id}:${isoWeek(new Date())}`;
      if (!(await this.claimWeeklySlot(key))) continue;

      try {
        const rendered = await this.generateForFarmer(user.id);
        if (!rendered) continue;

        await this.notificationsService.sendEmail(
          user.email,
          rendered.subject,
          rendered.text,
          rendered.html,
        );
        this.logger.info({ userId: user.id }, 'Weekly deal digest sent');
      } catch (err: any) {
        await this.releaseWeeklySlot(key);
        this.logger.error(
          { userId: user.id, error: err.message },
          'Failed to send weekly digest',
        );
      }
    }
  }

  verifyUnsubscribeToken(userId: string, token: string): boolean {
    const expected = this.hmacFor(userId);
    const a = Buffer.from(expected);
    const b = Buffer.from(token ?? '');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  unsubscribeUrl(userId: string): string {
    const base = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:3001',
    );
    return `${base}/users/unsubscribe?userId=${userId}&token=${this.hmacFor(userId)}`;
  }

  private hmacFor(userId: string): string {
    const secret =
      this.config.get<string>('JWT_SECRET') ??
      this.config.get<string>('APP_SECRET') ??
      'insecure-dev-secret';
    return crypto.createHmac('sha256', secret).update(userId).digest('hex');
  }

  renderDealRow(deal: TradeDeal): string {
    const total = Number(deal.totalValue ?? 0);
    const invested = Math.min(Number(deal.totalInvested ?? 0), total);
    const pct = total > 0 ? Math.round((invested / total) * 100) : 0;

    return (
      `<p style="margin:0 0 6px 0;"><strong>${escapeHtml(deal.commodity)}</strong>` +
      ` (${escapeHtml(deal.tokenSymbol)}): $${invested.toLocaleString('en-US')}` +
      ` of $${total.toLocaleString('en-US')} — ${pct}% funded` +
      `<span style="display:inline-block;width:120px;height:10px;background:#e5e7eb;` +
      `border-radius:5px;margin-left:8px;vertical-align:middle;">` +
      `<span style="display:inline-block;height:10px;border-radius:5px;background:#16a34a;` +
      `width:${pct}%;"></span></span></p>`
    );
  }

  renderFundingChart(deals: TradeDeal[]): string {
    if (deals.length === 0) return '';
    const barWidth = 40;
    const gap = 20;
    const chartHeight = 120;

    const bars = deals
      .map((deal, index) => {
        const total = Number(deal.totalValue ?? 0);
        const invested = Math.min(Number(deal.totalInvested ?? 0), total);
        const pct = total > 0 ? invested / total : 0;
        const h = Math.max(2, Math.round(pct * (chartHeight - 30)));
        const x = index * (barWidth + gap) + 10;
        const y = chartHeight - 20 - h;
        const label = escapeHtml(deal.commodity.slice(0, 7));
        return (
          `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3" fill="#16a34a"></rect>` +
          `<text x="${x + barWidth / 2}" y="${chartHeight - 6}" font-size="9" text-anchor="middle" fill="#374151">${label}</text>` +
          `<text x="${x + barWidth / 2}" y="${y - 4}" font-size="9" text-anchor="middle" fill="#111827">${Math.round(pct * 100)}%</text>`
        );
      })
      .join('');

    const svgWidth = deals.length * (barWidth + gap) + 20;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${chartHeight}" role="img" aria-label="Funding progress by deal">` +
      bars +
      '</svg>'
    );
  }

  private buildActionItems(
    deals: TradeDeal[],
    missingDocs: TradeDeal[],
    newInvestments: Investment[],
  ): string {
    const items: string[] = [];

    if (missingDocs.length > 0) {
      items.push(
        `Upload outstanding documents for ${missingDocs.length} deal(s) before delivery.`,
      );
    }
    const fullyFunded = deals.filter(
      (d) =>
        d.status === 'funded' &&
        Number(d.totalInvested) >= Number(d.totalValue),
    );
    if (fullyFunded.length > 0) {
      items.push(
        `${fullyFunded.length} deal(s) fully funded — prepare shipment for delivery.`,
      );
    }
    if (newInvestments.length > 0) {
      items.push(
        `${newInvestments.length} new investment(s) arrived this week — consider thanking your investors.`,
      );
    }
    if (items.length === 0) {
      items.push('No urgent actions — keep up the great work.');
    }
    return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  }

  isMondaySevenLocal(timezone?: string | null): boolean {
    const tz = timezone?.trim() || 'UTC';
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        hour: 'numeric',
        hour12: false,
      }).formatToParts(new Date());

      const weekday = parts.find((p) => p.type === 'weekday')?.value;
      const hour = Number(parts.find((p) => p.type === 'hour')?.value);
      return weekday === 'Mon' && hour === 7;
    } catch {
      const utcHour = new Date().getUTCHours();
      return new Date().getUTCDay() === 1 && utcHour === 7;
    }
  }

  private async claimWeeklySlot(key: string): Promise<boolean> {
    const client = this.redisClient;
    if (client?.isOpen) {
      const res = await client.set(key, '1', { EX: 7 * 24 * 3600, NX: true });
      return res === 'OK';
    }
    if (this.sentThisRun.has(key)) return false;
    this.sentThisRun.add(key);
    return true;
  }

  private async releaseWeeklySlot(key: string): Promise<void> {
    const client = this.redisClient;
    if (client?.isOpen) {
      await client.del(key);
      return;
    }
    this.sentThisRun.delete(key);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isoWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
