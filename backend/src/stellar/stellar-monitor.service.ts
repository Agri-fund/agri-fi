import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';

/**
 * Monitors Stellar platform wallet health.
 * - Tracks XLM balance and alerts if below threshold
 * - Monitors transaction volume
 * - Projects monthly XLM fee burn
 * Issue #359 — Build platform Stellar balance monitoring worker
 */
@Injectable()
export class StellarMonitorService {
  private readonly logger = new Logger(StellarMonitorService.name);
  private readonly server: Horizon.Server;
  private readonly platformAccountId: string | null = null;

  // Balance threshold for alerting (configurable, default 50 XLM)
  private readonly BALANCE_THRESHOLD_XLM: number;

  // Track last alert time to prevent spamming
  private lastAlertTime: number = 0;
  // Cooldown in milliseconds (e.g., 1 hour)
  private readonly ALERT_COOLDOWN_MS = 60 * 60 * 1000;

  // Transaction monitoring
  private transactionHistory: Array<{ timestamp: number; fee: number }> = [];
  private readonly MAX_HISTORY_ENTRIES = 1000;

  constructor(private readonly config: ConfigService) {
    const horizonUrl = this.config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new Horizon.Server(horizonUrl);

    // Load balance threshold from config, default to 50 XLM
    this.BALANCE_THRESHOLD_XLM = this.config.get<number>(
      'STELLAR_MONITOR_BALANCE_THRESHOLD',
      50,
    );

    const platformSecret = this.config.get<string>(
      'STELLAR_PLATFORM_SECRET',
      '',
    );
    if (platformSecret) {
      try {
        const keypair = Keypair.fromSecret(platformSecret);
        this.platformAccountId = keypair.publicKey();
      } catch (err) {
        this.logger.warn('Failed to parse STELLAR_PLATFORM_SECRET for monitor');
      }
    }

    this.logger.log(
      `StellarMonitorService initialized with balance threshold: ${this.BALANCE_THRESHOLD_XLM} XLM`,
    );
  }

  /**
   * Runs every 10 minutes to check platform wallet XLM balance,
   * monitor transaction volume, and project monthly fee burn.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkFeePoolBalance() {
    this.logger.log('Starting platform wallet health check...');

    if (!this.platformAccountId) {
      this.logger.warn(
        'No platform account configured. Skipping balance check.',
      );
      return;
    }

    try {
      const account = await this.server.loadAccount(this.platformAccountId);

      // Find native XLM balance
      const nativeBalanceStr =
        account.balances.find((b) => b.asset_type === 'native')?.balance || '0';
      const nativeBalance = parseFloat(nativeBalanceStr);

      // Get sequence number and subentry count for activity metrics
      const sequenceNumber = BigInt(account.sequenceNumber());
      const subentryCount = account.subentry_count || 0;

      // Fetch recent transactions for fee analysis
      const transactions = await this.fetchRecentTransactions();
      const feeMetrics = this.analyzeFeeMetrics(transactions);

      // Log comprehensive metrics
      this.logger.log(
        {
          xlmBalance: nativeBalance,
          thresholdXlm: this.BALANCE_THRESHOLD_XLM,
          sequenceNumber: sequenceNumber.toString(),
          subentryCount,
          recentTxCount: transactions.length,
          avgFeeXlm: feeMetrics.avgFeeXlm,
          totalFeesXlm: feeMetrics.totalFeesXlm,
          projectedMonthlyBurnXlm: feeMetrics.projectedMonthlyBurnXlm,
        },
        'Platform wallet health metrics',
      );

      // Check if balance is critically low
      if (nativeBalance < this.BALANCE_THRESHOLD_XLM) {
        await this.triggerLowBalanceAlert(nativeBalance, feeMetrics);
      } else if (this.lastAlertTime > 0) {
        // Reset cooldown if balance is restored above threshold
        this.logger.log(
          'Balance restored above threshold, resetting alert cooldown.',
        );
        this.lastAlertTime = 0;
      }
    } catch (error: any) {
      this.logger.error('Error checking fee pool balance', error.stack);
    }
  }

  /**
   * Fetches recent transactions from the platform account.
   * Used to analyze transaction volume and fee patterns.
   */
  private async fetchRecentTransactions(): Promise<
    Array<{ fee_charged: string; created_at: string }>
  > {
    try {
      const transactions = await this.server
        .transactions()
        .forAccount(this.platformAccountId!)
        .order('desc')
        .limit(100)
        .call();

      return transactions.records || [];
    } catch (error: any) {
      this.logger.warn('Failed to fetch recent transactions', error.message);
      return [];
    }
  }

  /**
   * Analyzes fee metrics from recent transactions.
   * Projects monthly XLM fee burn based on current activity.
   */
  private analyzeFeeMetrics(
    transactions: Array<{ fee_charged: string; created_at: string }>,
  ): {
    avgFeeXlm: number;
    totalFeesXlm: number;
    projectedMonthlyBurnXlm: number;
  } {
    if (transactions.length === 0) {
      return {
        avgFeeXlm: 0,
        totalFeesXlm: 0,
        projectedMonthlyBurnXlm: 0,
      };
    }

    // Convert stroops (1 XLM = 10,000,000 stroops) to XLM
    const feesInXlm = transactions.map(
      (tx) => parseFloat(tx.fee_charged) / 10_000_000,
    );
    const totalFeesXlm = feesInXlm.reduce((sum, fee) => sum + fee, 0);
    const avgFeeXlm = totalFeesXlm / transactions.length;

    // Calculate time span of transactions
    const oldestTx = transactions[transactions.length - 1];
    const newestTx = transactions[0];
    const timeSpanMs =
      new Date(newestTx.created_at).getTime() -
      new Date(oldestTx.created_at).getTime();
    const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);

    // Project monthly burn (30 days)
    const projectedMonthlyBurnXlm =
      timeSpanDays > 0 ? (totalFeesXlm / timeSpanDays) * 30 : 0;

    return {
      avgFeeXlm: Math.round(avgFeeXlm * 1_000_000) / 1_000_000,
      totalFeesXlm: Math.round(totalFeesXlm * 1_000_000) / 1_000_000,
      projectedMonthlyBurnXlm: Math.round(projectedMonthlyBurnXlm * 100) / 100,
    };
  }

  /**
   * Triggers alert when XLM balance falls below threshold.
   * Sends webhook to Discord/Slack/PagerDuty with metrics.
   */
  private async triggerLowBalanceAlert(
    balance: number,
    feeMetrics: {
      avgFeeXlm: number;
      totalFeesXlm: number;
      projectedMonthlyBurnXlm: number;
    },
  ) {
    const now = Date.now();
    if (now - this.lastAlertTime < this.ALERT_COOLDOWN_MS) {
      this.logger.warn(
        `Low balance alert suppressed due to cooldown. Balance is ${balance} XLM`,
      );
      return;
    }

    const webhookUrl = this.config.get<string>('ALERT_WEBHOOK_URL');
    const daysUntilEmpty =
      feeMetrics.projectedMonthlyBurnXlm > 0
        ? Math.floor((balance / feeMetrics.projectedMonthlyBurnXlm) * 30)
        : -1;

    const alertMessage = {
      // Discord embed format
      embeds: [
        {
          title: '🚨 CRITICAL: Stellar Platform Wallet Balance Low',
          description: `The platform wallet is running low on XLM and needs immediate funding.`,
          color: 16711680, // Red
          fields: [
            {
              name: 'Current Balance',
              value: `${balance} XLM`,
              inline: true,
            },
            {
              name: 'Alert Threshold',
              value: `${this.BALANCE_THRESHOLD_XLM} XLM`,
              inline: true,
            },
            {
              name: 'Account ID',
              value: `\`${this.platformAccountId}\``,
              inline: false,
            },
            {
              name: 'Average Fee per Transaction',
              value: `${feeMetrics.avgFeeXlm} XLM`,
              inline: true,
            },
            {
              name: 'Projected Monthly Burn',
              value: `${feeMetrics.projectedMonthlyBurnXlm} XLM`,
              inline: true,
            },
            {
              name: 'Days Until Empty (est.)',
              value: `${daysUntilEmpty > 0 ? daysUntilEmpty : 'N/A'} days`,
              inline: true,
            },
          ],
          footer: {
            text: 'Stellar Balance Monitor',
            icon_url: 'https://stellar.org/favicon.ico',
          },
          timestamp: new Date().toISOString(),
        },
      ],
      // Fallback text for Slack
      text: `🚨 CRITICAL: Stellar Platform Account has low balance of ${balance} XLM (threshold: ${this.BALANCE_THRESHOLD_XLM} XLM). Projected monthly burn: ${feeMetrics.projectedMonthlyBurnXlm} XLM. Please fund wallet: ${this.platformAccountId}`,
      // Generic webhook fields for PagerDuty
      summary: `Stellar Platform Account Low Balance - ${balance} XLM`,
      source: 'agric-onchain-backend',
      severity: 'critical',
      custom_details: {
        currentBalance: balance,
        thresholdXlm: this.BALANCE_THRESHOLD_XLM,
        accountId: this.platformAccountId,
        avgFeeXlm: feeMetrics.avgFeeXlm,
        projectedMonthlyBurnXlm: feeMetrics.projectedMonthlyBurnXlm,
        estimatedDaysUntilEmpty: daysUntilEmpty,
      },
    };

    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, alertMessage);
        this.logger.log('Successfully triggered low balance webhook alert.');
        this.lastAlertTime = now;
      } catch (error: any) {
        this.logger.error('Failed to trigger webhook alert', error.message);
      }
    } else {
      this.logger.error(
        `ALERT_WEBHOOK_URL not configured! ${alertMessage.text}`,
      );
      // Also update last alert time even if webhook isn't configured so we don't spam the logs
      this.lastAlertTime = now;
    }
  }
}
