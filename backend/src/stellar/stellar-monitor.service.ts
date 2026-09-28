import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { Counter, register } from 'prom-client';
import axios from 'axios';
import { AccountMergeRecovery } from './entities/account-merge-recovery.entity';
import { UnrecognisedPayment } from './entities/unrecognised-payment.entity';
import { StellarService } from './stellar.service';
import { Investment, InvestmentStatus } from '../investments/entities/investment.entity';

/** Matches DEAL-{dealId}-INV-{investmentId} */
const MEMO_PATTERN = /^DEAL-([^-]+-[^-]+-[^-]+-[^-]+)-INV-([^-]+-[^-]+-[^-]+-[^-]+)$/;

interface HorizonPaymentRecord {
  id: string;
  type: string;
  transaction_hash: string;
  created_at: string;
  from: string;
  to: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction?: {
    memo?: string;
    memo_type?: string;
  };
}

/**
 * Monitors Stellar platform wallet health and streams incoming payments in
 * real-time to immediately credit investor investments.
 *
 * Issue #359 — Build platform Stellar balance monitoring worker
 * Issue #905 — Stellar payment streaming
 *
 * Features:
 * - Horizon SSE payment stream with exponential back-off reconnection
 * - Memo-based investment matching (DEAL-{dealId}-INV-{investmentId})
 * - Duplicate payment detection via transaction hash
 * - Unmatched payments logged to unrecognised_payments table + admin alert
 * - Prometheus counters: stellar_payments_received_total,
 *                        stellar_payments_unmatched_total
 * - 60-second polling fallback for missed stream events
 */
@Injectable()
export class StellarMonitorService
  implements OnModuleInit, OnModuleDestroy
{
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

  // ── Payment stream ─────────────────────────────────────────────────────────
  /** Handle returned by Horizon's call() to allow stream close on shutdown */
  private streamClose: (() => void) | null = null;
  /** Exponential back-off state */
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly MAX_RECONNECT_DELAY_MS = 60_000; // 1 minute cap

  /** Cursor used for the 60-second polling fallback */
  private lastProcessedPagingToken: string = 'now';

  // ── Prometheus counters ───────────────────────────────────────────────────
  private readonly paymentsReceivedCounter: Counter;
  private readonly paymentsUnmatchedCounter: Counter;

  constructor(
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
    @InjectRepository(AccountMergeRecovery)
    private readonly mergeRecoveryRepo: Repository<AccountMergeRecovery>,
    @InjectRepository(UnrecognisedPayment)
    private readonly unrecognisedPaymentRepo: Repository<UnrecognisedPayment>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly stellarService: StellarService,
  ) {
    this.logger.setContext(StellarMonitorService.name);
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
      } catch {
        this.logger.warn('Failed to parse STELLAR_PLATFORM_SECRET for monitor');
      }
    }

    // Initialise Prometheus counters using prom-client directly (consistent
    // with the pattern used by StellarPrometheusService).
    this.paymentsReceivedCounter = new Counter({
      name: 'stellar_payments_received_total',
      help: 'Total number of incoming Stellar payments received on the platform escrow account.',
      registers: [register],
    });

    this.paymentsUnmatchedCounter = new Counter({
      name: 'stellar_payments_unmatched_total',
      help: 'Total number of incoming Stellar payments that could not be matched to a pending investment.',
      registers: [register],
    });

    this.logger.log(
      `StellarMonitorService initialized with balance threshold: ${this.BALANCE_THRESHOLD_XLM} XLM`,
    );
  }

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  onModuleInit(): void {
    if (this.platformAccountId) {
      this.startPaymentStream();
    } else {
      this.logger.warn(
        'Platform account not configured — payment stream will not start.',
      );
    }
  }

  onModuleDestroy(): void {
    this.stopPaymentStream();
  }

  // ── Payment streaming ──────────────────────────────────────────────────────

  /**
   * Opens a Horizon SSE stream for payments arriving on the platform escrow
   * account.  On any error the stream is closed and re-opened with exponential
   * back-off (1 s → 2 s → 4 s … capped at 60 s).
   */
  private startPaymentStream(): void {
    if (!this.platformAccountId) return;

    this.logger.info(
      { account: this.platformAccountId },
      'Starting Horizon payment stream',
    );

    try {
      this.streamClose = this.server
        .payments()
        .forAccount(this.platformAccountId)
        .cursor(this.lastProcessedPagingToken)
        .stream({
          onmessage: (payment) => {
            this.reconnectAttempt = 0; // reset back-off on successful message
            void this.handleIncomingPayment(payment as HorizonPaymentRecord);
          },
          onerror: (error) => {
            this.logger.warn(
              { error: String(error) },
              'Horizon payment stream error — scheduling reconnect',
            );
            this.stopPaymentStream();
            this.scheduleReconnect();
          },
        });
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to open Horizon payment stream — scheduling reconnect',
      );
      this.scheduleReconnect();
    }
  }

  private stopPaymentStream(): void {
    if (this.streamClose) {
      try {
        this.streamClose();
      } catch {
        // ignore
      }
      this.streamClose = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // already scheduled

    const delayMs = Math.min(
      1_000 * 2 ** this.reconnectAttempt,
      this.MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;

    this.logger.info(
      { attempt: this.reconnectAttempt, delayMs },
      'Scheduling Horizon stream reconnect with exponential back-off',
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startPaymentStream();
    }, delayMs);
  }

  // ── Payment processing ─────────────────────────────────────────────────────

  /**
   * Processes a single payment record from the Horizon SSE stream.
   * Only "payment" type operations incoming to the platform account are handled.
   */
  private async handleIncomingPayment(
    payment: HorizonPaymentRecord,
  ): Promise<void> {
    // Only handle payments credited to the platform account
    if (payment.to !== this.platformAccountId) return;
    // Ignore non-payment operations (e.g. create_account)
    if (payment.type !== 'payment') return;

    this.paymentsReceivedCounter.inc();

    // Advance the polling fallback cursor so it only catches events not yet
    // handled by the stream.
    this.lastProcessedPagingToken = payment.id;

    const txHash = payment.transaction_hash;

    this.logger.info(
      {
        txHash,
        from: payment.from,
        amount: payment.amount,
        asset: payment.asset_code ?? 'XLM',
      },
      'Incoming payment received on platform escrow account',
    );

    // ── Duplicate detection ────────────────────────────────────────────────
    if (await this.isDuplicatePayment(txHash)) {
      this.logger.warn(
        { txHash },
        'Duplicate payment detected — skipping processing',
      );
      return;
    }

    // ── Memo parsing ──────────────────────────────────────────────────────
    const memo = await this.fetchTransactionMemo(txHash);
    const parsed = this.parseMemo(memo);

    if (!parsed) {
      await this.recordUnrecognisedPayment(payment, memo, 'memo_invalid_format');
      return;
    }

    const { dealId, investmentId } = parsed;

    // ── Investment matching ────────────────────────────────────────────────
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId, tradeDealId: dealId },
    });

    if (!investment) {
      await this.recordUnrecognisedPayment(
        payment,
        memo,
        `investment_not_found:deal=${dealId},inv=${investmentId}`,
      );
      return;
    }

    if (investment.status !== InvestmentStatus.PENDING) {
      this.logger.warn(
        { investmentId, currentStatus: investment.status, txHash },
        'Payment matched but investment is not in PENDING status — skipping',
      );
      // Treat as unrecognised to surface it for admin review
      await this.recordUnrecognisedPayment(
        payment,
        memo,
        `investment_not_pending:status=${investment.status}`,
      );
      return;
    }

    // ── Credit the investment ──────────────────────────────────────────────
    await this.creditInvestment(investment, txHash);
  }

  /**
   * Updates an investment from PENDING → CONFIRMED with the matching Stellar
   * transaction hash.
   */
  private async creditInvestment(
    investment: Investment,
    txHash: string,
  ): Promise<void> {
    investment.status = InvestmentStatus.CONFIRMED;
    investment.stellarTxId = txHash;
    await this.investmentRepo.save(investment);

    this.logger.info(
      {
        investmentId: investment.id,
        dealId: investment.tradeDealId,
        txHash,
      },
      'Investment credited — status updated to CONFIRMED',
    );
  }

  /**
   * Fetches the memo from the parent transaction of a payment operation.
   * Returns null if unavailable or not a text memo.
   */
  private async fetchTransactionMemo(
    txHash: string,
  ): Promise<string | null> {
    try {
      const tx = await this.server.transactions().transaction(txHash).call();
      if ((tx as any).memo_type === 'text' && (tx as any).memo) {
        return String((tx as any).memo);
      }
      return null;
    } catch (err: any) {
      this.logger.warn(
        { txHash, error: err.message },
        'Failed to fetch transaction memo — treating as unrecognised',
      );
      return null;
    }
  }

  /**
   * Parses a memo string matching DEAL-{dealId}-INV-{investmentId}.
   * Returns null if the memo does not match the expected format.
   */
  parseMemo(memo: string | null): { dealId: string; investmentId: string } | null {
    if (!memo) return null;
    const match = MEMO_PATTERN.exec(memo.trim());
    if (!match) return null;
    return { dealId: match[1], investmentId: match[2] };
  }

  /**
   * Checks whether we have already processed (or logged) a payment with this
   * transaction hash.  Prevents double-crediting on stream reconnection.
   */
  private async isDuplicatePayment(txHash: string): Promise<boolean> {
    // Check if already confirmed via this tx hash
    const confirmed = await this.investmentRepo.findOne({
      where: { stellarTxId: txHash },
    });
    if (confirmed) return true;

    // Check if already logged as unrecognised
    const unrecognised = await this.unrecognisedPaymentRepo.findOne({
      where: { txHash },
    });
    return !!unrecognised;
  }

  /**
   * Persists an unmatched/unrecognised payment and fires an admin alert.
   */
  private async recordUnrecognisedPayment(
    payment: HorizonPaymentRecord,
    memo: string | null,
    reason: string,
  ): Promise<void> {
    this.paymentsUnmatchedCounter.inc();

    try {
      const record = this.unrecognisedPaymentRepo.create({
        txHash: payment.transaction_hash,
        fromAccount: payment.from,
        amount: payment.amount,
        assetCode: payment.asset_code ?? null,
        assetIssuer: payment.asset_issuer ?? null,
        memo,
        reason,
        stellarCreatedAt: payment.created_at
          ? new Date(payment.created_at)
          : null,
      });
      await this.unrecognisedPaymentRepo.save(record);
    } catch (saveErr: any) {
      this.logger.error(
        { txHash: payment.transaction_hash, error: saveErr.message },
        'Failed to persist unrecognised payment record',
      );
    }

    this.logger.warn(
      {
        txHash: payment.transaction_hash,
        from: payment.from,
        amount: payment.amount,
        memo,
        reason,
      },
      'Unrecognised payment — logged and admin alert triggered',
    );

    await this.sendUnrecognisedPaymentAlert(payment, memo, reason);
  }

  /**
   * Fires a webhook alert (Discord/Slack) for an unrecognised payment so ops
   * can investigate immediately.
   */
  private async sendUnrecognisedPaymentAlert(
    payment: HorizonPaymentRecord,
    memo: string | null,
    reason: string,
  ): Promise<void> {
    const webhookUrl = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(
        'ALERT_WEBHOOK_URL not configured — skipping unrecognised payment alert',
      );
      return;
    }

    const alertMessage = {
      embeds: [
        {
          title: '⚠️ Unrecognised Stellar Payment Received',
          description:
            'An incoming payment could not be matched to a pending investment.',
          color: 16753920, // Orange
          fields: [
            { name: 'Transaction Hash', value: `\`${payment.transaction_hash}\``, inline: false },
            { name: 'From', value: `\`${payment.from}\``, inline: false },
            { name: 'Amount', value: `${payment.amount} ${payment.asset_code ?? 'XLM'}`, inline: true },
            { name: 'Memo', value: memo ?? '(none)', inline: true },
            { name: 'Reason', value: reason, inline: false },
          ],
          footer: { text: 'Stellar Payment Stream Monitor' },
          timestamp: new Date().toISOString(),
        },
      ],
      text: `⚠️ Unrecognised Stellar payment from ${payment.from}: ${payment.amount} ${payment.asset_code ?? 'XLM'} — memo: "${memo ?? ''}" — reason: ${reason}`,
    };

    try {
      await axios.post(webhookUrl, alertMessage);
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to send unrecognised payment alert',
      );
    }
  }

  // ── Polling fallback ───────────────────────────────────────────────────────

  /**
   * Polls for payments every 60 seconds as a fallback in case the SSE stream
   * misses any events (e.g., during reconnect windows).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollPaymentsFallback(): Promise<void> {
    if (!this.platformAccountId) return;

    this.logger.debug(
      { cursor: this.lastProcessedPagingToken },
      'Running 60-second payment polling fallback',
    );

    try {
      const result = await this.server
        .payments()
        .forAccount(this.platformAccountId)
        .cursor(this.lastProcessedPagingToken)
        .order('asc')
        .limit(50)
        .call();

      const records: HorizonPaymentRecord[] = result.records ?? [];

      for (const payment of records) {
        // Update cursor to the latest paging token we've seen
        if (payment.id > this.lastProcessedPagingToken) {
          this.lastProcessedPagingToken = payment.id;
        }
        await this.handleIncomingPayment(payment);
      }
    } catch (err: any) {
      this.logger.warn(
        { error: err.message },
        'Payment polling fallback failed',
      );
    }
  }

  // ── Existing cron: fee pool balance ───────────────────────────────────────

  /**
   * Runs every 10 minutes to check platform wallet XLM balance,
   * monitor transaction volume, and project monthly fee burn.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkFeePoolBalance() {
    this.logger.info('Starting platform wallet health check...');

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
      this.logger.info(
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
        this.logger.info(
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

      return (transactions.records || []).map((record) => ({
        fee_charged:
          typeof record.fee_charged === 'string'
            ? record.fee_charged
            : String(record.fee_charged),
        created_at: record.created_at,
      }));
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
        this.logger.info('Successfully triggered low balance webhook alert.');
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

  // ── Existing cron: account merge detection ────────────────────────────────

  /**
   * Detects Stellar account merge operations every 5 minutes.
   * Creates AccountMergeRecovery records for tracking and initiates recovery.
   * Issue #683 — Account merge handler re-establishes trustlines
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectAccountMerges() {
    this.logger.log('Starting account merge detection...');

    try {
      // Get all unresolved merge records (detected but not yet recovered)
      const pendingMerges = await this.mergeRecoveryRepo.find({
        where: [{ status: 'detected' }, { status: 'replacement_created' }],
      });

      this.logger.debug(
        { count: pendingMerges.length },
        'Found pending merge recovery records',
      );

      // Attempt recovery for each pending merge
      for (const mergeRecord of pendingMerges) {
        await this.attemptMergeRecovery(mergeRecord);
      }

      // Scan recent transactions for new merges
      const recentTxs = await this.fetchRecentTransactions();
      const mergeTxs = recentTxs.filter((tx: any) =>
        tx.operations?.some((op: any) => op.type === 'account_merge'),
      );

      this.logger.debug(
        { count: mergeTxs.length },
        'Found recent account merge transactions',
      );

      for (const tx of mergeTxs) {
        await this.processAccountMergeTx(tx);
      }
    } catch (error: any) {
      this.logger.error(
        { error: error.message },
        'Error detecting account merges',
      );
    }
  }

  /**
   * Processes a Stellar transaction containing an account merge operation.
   * Creates recovery record and initiates replacement account creation.
   */
  private async processAccountMergeTx(tx: any): Promise<void> {
    const mergeOps = tx.operations.filter(
      (op: any) => op.type === 'account_merge',
    );

    for (const op of mergeOps) {
      const originalPublicKey = op.source_account || tx.source_account;
      const mergedPublicKey = op.into; // Destination account that receives the merge

      // Check if already tracked
      const existing = await this.mergeRecoveryRepo.findOne({
        where: { originalPublicKey, mergedPublicKey },
      });

      if (existing) {
        this.logger.debug(
          { originalPublicKey, mergedPublicKey },
          'Merge already tracked, skipping',
        );
        continue;
      }

      // Create new recovery record
      const recovery = this.mergeRecoveryRepo.create({
        originalPublicKey,
        mergedPublicKey,
        status: 'detected',
        detectedInTxHash: tx.id,
      });

      await this.mergeRecoveryRepo.save(recovery);

      this.logger.info(
        { recoveryId: recovery.id, originalPublicKey, mergedPublicKey },
        'Account merge detected, recovery record created',
      );
    }
  }

  /**
   * Attempts to recover a merged account by creating a replacement with trustlines.
   */
  private async attemptMergeRecovery(
    recovery: AccountMergeRecovery,
  ): Promise<void> {
    try {
      if (recovery.status === 'detected') {
        // Create replacement account
        const { publicKey, secretKey } =
          await this.stellarService.createReplacementAccount();

        recovery.replacementPublicKey = publicKey;
        recovery.replacementSecretKeyEncrypted =
          await this.stellarService.encryptSecret(secretKey);
        recovery.status = 'replacement_created';

        await this.mergeRecoveryRepo.save(recovery);

        this.logger.info(
          {
            recoveryId: recovery.id,
            replacementPublicKey: publicKey,
          },
          'Replacement account created for merge recovery',
        );
      }

      if (
        recovery.status === 'replacement_created' &&
        recovery.replacementPublicKey
      ) {
        // Verify trustline is established
        const account = await this.server.loadAccount(
          recovery.replacementPublicKey,
        );
        const hasTrustline = account.balances.some(
          (b: any) =>
            b.asset_code === 'USDC' &&
            b.asset_issuer === this.config.get('USDC_ISSUER'),
        );

        if (hasTrustline) {
          recovery.status = 'trustline_established';
          recovery.recoveredAt = new Date();
          await this.mergeRecoveryRepo.save(recovery);

          this.logger.info(
            {
              recoveryId: recovery.id,
              replacementPublicKey: recovery.replacementPublicKey,
            },
            'Account merge recovery completed - trustline established',
          );
        }
      }
    } catch (error: any) {
      recovery.lastErrorMessage = error.message;
      recovery.paymentRetryAttempts++;

      if (recovery.paymentRetryAttempts >= 3) {
        recovery.status = 'failed';
        await this.mergeRecoveryRepo.save(recovery);

        // Alert ops after 3 failed attempts
        await this.alertMergeRecoveryFailure(recovery, error);

        this.logger.error(
          {
            recoveryId: recovery.id,
            attempts: recovery.paymentRetryAttempts,
            error: error.message,
          },
          'Account merge recovery failed after 3 attempts - ops alert sent',
        );
      } else {
        await this.mergeRecoveryRepo.save(recovery);
        this.logger.warn(
          {
            recoveryId: recovery.id,
            attempts: recovery.paymentRetryAttempts,
            error: error.message,
          },
          'Account merge recovery attempt failed, will retry',
        );
      }
    }
  }

  /**
   * Alerts ops when account merge recovery fails after max retries.
   */
  private async alertMergeRecoveryFailure(
    recovery: AccountMergeRecovery,
    error: Error,
  ): Promise<void> {
    const webhookUrl = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(
        'ALERT_WEBHOOK_URL not configured - skipping merge recovery alert',
      );
      return;
    }

    const alertMessage = {
      embeds: [
        {
          title: '🚨 Account Merge Recovery Failed',
          description: `Failed to recover from account merge after 3 attempts.`,
          color: 16711680, // Red
          fields: [
            {
              name: 'Recovery ID',
              value: recovery.id,
              inline: true,
            },
            {
              name: 'Original Account',
              value: `\`${recovery.originalPublicKey}\``,
              inline: false,
            },
            {
              name: 'Merged Into',
              value: `\`${recovery.mergedPublicKey}\``,
              inline: false,
            },
            {
              name: 'Last Error',
              value: error.message,
              inline: false,
            },
            {
              name: 'Attempts',
              value: recovery.paymentRetryAttempts.toString(),
              inline: true,
            },
          ],
          footer: {
            text: 'Stellar Account Merge Monitor',
          },
          timestamp: new Date().toISOString(),
        },
      ],
      text: `🚨 Account merge recovery failed for ${recovery.originalPublicKey}`,
    };

    try {
      await axios.post(webhookUrl, alertMessage);
      this.logger.info('Merge recovery failure alert sent');
    } catch (err: any) {
      this.logger.error('Failed to send merge recovery alert', err.message);
    }
  }
}
