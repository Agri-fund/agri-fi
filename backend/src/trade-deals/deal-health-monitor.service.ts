import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import {
  DealHealthAlert,
  DealHealthAlertType,
} from './entities/deal-health-alert.entity';

/** Thresholds for warning triggers */
const FUNDING_LOW_THRESHOLD = 30;
const FUNDING_LOW_DAYS_REMAINING = 7;
const NO_INVESTMENT_HOURS = 48;
const SHIPMENT_OVERDUE_HOURS = 24;
const REVENUE_DISTRIBUTION_DAYS = 7;

@Injectable()
export class DealHealthMonitorService {
  private readonly logger = new Logger(DealHealthMonitorService.name);

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(DealHealthAlert)
    private readonly alertRepo: Repository<DealHealthAlert>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    @InjectMetric('deal_health_alerts_active_total')
    private readonly activeAlertsGauge: Gauge<string>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHealthChecks(): Promise<void> {
    this.logger.log('Running deal health monitoring checks');

    try {
      const openDeals = await this.tradeDealRepo.find({
        where: [{ status: 'open' }, { status: 'funded' }],
      });

      for (const deal of openDeals) {
        await this.checkFundingBelowThreshold(deal);
        await this.checkNoRecentInvestment(deal);
        await this.checkShipmentOverdue(deal);
        await this.checkRevenueNotDistributed(deal);
      }

      await this.refreshActiveAlertsGauge();
    } catch (error) {
      this.logger.error({ error }, 'Failed to run deal health checks');
    }
  }

  async checkFundingBelowThreshold(deal: TradeDeal): Promise<void> {
    const totalValue = Number(deal.totalValue);
    if (totalValue <= 0) return;

    const totalInvested = Number(deal.totalInvested);
    const pct = (totalInvested / totalValue) * 100;
    const daysRemaining = this.getDaysUntilDelivery(deal);

    if (
      pct < FUNDING_LOW_THRESHOLD &&
      daysRemaining <= FUNDING_LOW_DAYS_REMAINING
    ) {
      await this.fireAlert(
        deal,
        'funding_below_threshold',
        `Deal ${deal.tokenSymbol} is only ${pct.toFixed(1)}% funded with ${daysRemaining} days remaining until delivery.`,
        { fundingPct: pct, daysRemaining, totalValue, totalInvested },
      );
    } else {
      await this.resolveAlert(deal.id, 'funding_below_threshold');
    }
  }

  async checkNoRecentInvestment(deal: TradeDeal): Promise<void> {
    const latestInvestment = await this.investmentRepo.findOne({
      where: { tradeDealId: deal.id },
      order: { createdAt: 'DESC' },
    });

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - NO_INVESTMENT_HOURS);

    if (!latestInvestment || latestInvestment.createdAt < cutoff) {
      await this.fireAlert(
        deal,
        'no_recent_investment',
        `Deal ${deal.tokenSymbol} has received no new investment in the last ${NO_INVESTMENT_HOURS} hours.`,
        {
          lastInvestmentAt: latestInvestment?.createdAt?.toISOString() ?? null,
        },
      );
    } else {
      await this.resolveAlert(deal.id, 'no_recent_investment');
    }
  }

  async checkShipmentOverdue(deal: TradeDeal): Promise<void> {
    if (deal.status !== 'funded') return;

    const deliveryDate = new Date(deal.deliveryDate);
    const overdueThreshold = new Date();
    overdueThreshold.setHours(
      overdueThreshold.getHours() - SHIPMENT_OVERDUE_HOURS,
    );

    if (deliveryDate < overdueThreshold) {
      const overdueHours = Math.floor(
        (Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60),
      );

      await this.fireAlert(
        deal,
        'shipment_overdue',
        `Deal ${deal.tokenSymbol} shipment is ${overdueHours} hours overdue (delivery date: ${deliveryDate.toISOString().split('T')[0]}).`,
        { deliveryDate: deliveryDate.toISOString(), overdueHours },
      );
    } else {
      await this.resolveAlert(deal.id, 'shipment_overdue');
    }
  }

  async checkRevenueNotDistributed(deal: TradeDeal): Promise<void> {
    if (deal.status !== 'completed') return;

    const completedMilestone = await this.milestoneRepo.findOne({
      where: { tradeDealId: deal.id, milestone: 'importer' },
      order: { recordedAt: 'DESC' },
    });

    if (!completedMilestone) return;

    const daysSinceCompletion = Math.floor(
      (Date.now() - completedMilestone.recordedAt.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    if (daysSinceCompletion >= REVENUE_DISTRIBUTION_DAYS) {
      await this.fireAlert(
        deal,
        'revenue_not_distributed',
        `Deal ${deal.tokenSymbol} has been completed for ${daysSinceCompletion} days but revenue has not been distributed.`,
        {
          completedAt: completedMilestone.recordedAt.toISOString(),
          daysSinceCompletion,
        },
      );
    } else {
      await this.resolveAlert(deal.id, 'revenue_not_distributed');
    }
  }

  async getActiveAlerts(): Promise<DealHealthAlert[]> {
    return this.alertRepo.find({
      where: { resolvedAt: IsNull() },
      relations: ['tradeDeal'],
      order: { firedAt: 'DESC' },
    });
  }

  async resolveAlert(
    dealId: string,
    alertType: DealHealthAlertType,
  ): Promise<void> {
    const activeAlert = await this.alertRepo.findOne({
      where: { dealId, alertType, resolvedAt: IsNull() },
    });

    if (!activeAlert) return;

    activeAlert.resolvedAt = new Date();
    await this.alertRepo.save(activeAlert);

    this.logger.log(
      { dealId, alertType, alertId: activeAlert.id },
      'Deal health alert resolved',
    );

    await this.auditService.logEvent({
      actorId: 'system',
      actorRole: 'system',
      route: 'deal-health-monitor/resolve',
      statusCode: 200,
      requestDetails: {
        action: 'alert_resolved',
        dealId,
        alertType,
        alertId: activeAlert.id,
      },
    });
  }

  private async fireAlert(
    deal: TradeDeal,
    alertType: DealHealthAlertType,
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.alertRepo.findOne({
      where: { dealId: deal.id, alertType, resolvedAt: IsNull() },
    });

    if (existing) {
      this.logger.debug(
        { dealId: deal.id, alertType },
        'Active alert already exists, skipping deduplication',
      );
      return;
    }

    const alert = this.alertRepo.create({
      dealId: deal.id,
      alertType,
      alertMessage: message,
      firedAt: new Date(),
      metadataJson: metadata,
    });
    await this.alertRepo.save(alert);

    this.logger.warn(
      { dealId: deal.id, alertType, alertId: alert.id },
      message,
    );

    await this.sendNotifications(deal, alertType, message);
    await this.logAudit(deal, alertType, alert.id);
  }

  private async sendNotifications(
    deal: TradeDeal,
    alertType: DealHealthAlertType,
    message: string,
  ): Promise<void> {
    const recipients = this.getRecipients(deal, alertType);

    for (const userId of recipients) {
      try {
        await this.notificationsService.createNotification({
          userId,
          type: 'alert',
          title: `Deal Health Warning: ${alertType.replace(/_/g, ' ')}`,
          message,
          linkUrl: `/marketplace/${deal.id}`,
          metadataJson: { alertType, dealId: deal.id },
        });
      } catch (error) {
        this.logger.error(
          { error, userId, dealId: deal.id, alertType },
          'Failed to send in-app notification for deal health alert',
        );
      }
    }
  }

  private getRecipients(
    deal: TradeDeal,
    alertType: DealHealthAlertType,
  ): string[] {
    const recipients = new Set<string>();

    if (deal.farmerId) recipients.add(deal.farmerId);
    if (deal.traderId) recipients.add(deal.traderId);

    if (alertType === 'sensor_out_of_range' && deal.traderId) {
      recipients.add(deal.traderId);
    }

    return Array.from(recipients);
  }

  private async logAudit(
    deal: TradeDeal,
    alertType: DealHealthAlertType,
    alertId: string,
  ): Promise<void> {
    await this.auditService.logEvent({
      actorId: 'system',
      actorRole: 'system',
      route: 'deal-health-monitor/fire',
      statusCode: 200,
      requestDetails: {
        action: 'alert_fired',
        dealId: deal.id,
        alertType,
        alertId,
      },
    });
  }

  private async refreshActiveAlertsGauge(): Promise<void> {
    try {
      const alertCounts = await this.alertRepo
        .createQueryBuilder('alert')
        .select('alert.alert_type', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('alert.resolved_at IS NULL')
        .groupBy('alert.alert_type')
        .getRawMany();

      for (const row of alertCounts) {
        this.activeAlertsGauge.set(
          { alertType: row.type },
          parseInt(row.count, 10),
        );
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to refresh active alerts gauge');
    }
  }

  private getDaysUntilDelivery(deal: TradeDeal): number {
    const deliveryDate = new Date(deal.deliveryDate);
    const now = new Date();
    return Math.ceil(
      (deliveryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
  }
}
