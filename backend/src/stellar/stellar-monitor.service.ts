import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { AccountMergeRecovery } from './entities/account-merge-recovery.entity';
import { UnrecognisedPayment } from './entities/unrecognised-payment.entity';
import { StellarService } from './stellar.service';
import { InvestmentsService } from '../investments/investments.service';

/**
 * Monitors Stellar platform wallet health.
 * - Tracks XLM balance and alerts if below threshold
 * - Monitors transaction volume
 * - Projects monthly XLM fee burn
 * Issue #359 — Build platform Stellar balance monitoring worker
 *
 * Also streams incoming payments to the platform escrow account and matches
 * them against pending investments using the memo format DEAL-{dealId}-INV-{id}.
 * Unmatched payments are persisted to `unrecognised_payments` and trigger an
 * ops alert.  A polling fallback (@Cron every 60 s) catches payments that may
 * have been missed while the stream was down.
 * Issue #905 — Stellar payment streaming & reconciliation
 */
@Injectable()
export class StellarMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly server: Horizon.Server;
  private readonly platformAccountId: string | null = null;

  // ── Balance monitor ────────────────────────────────────────────────────────

  private readonly BALANCE_THRESHOLD_XLM: number;

  /** Last time a low-balance alert was sent — prevents spam. */
  private lastAlertTime: number = 0;
  private readonly ALERT_COOLDOWN_MS = 60 * 60 * 1000;

  /** Recent transaction fee history used for burn-rate projection. */
  private transactionHistory: Array<{ timestamp: number; fee: number }> = [];
  private readonly MAX_HISTORY_ENTRIES = 1000;

  // ── Payment stream (Issue #905) ─────────────────────────────────────────────

  /** Handle returned by Horizon streaming call — call () to close the stream. */
  private paymentStream: (() => void) | null = null;

  /** Number of consecutive stream reconnect attempts (resets on success). */
  private streamReconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 20;
  /** Base delay for exponential backoff in milliseconds. */
  private readonly BASE_RECONNECT_DELAY_MS = 1000;

  /**
   * In-memory deduplification cache (ring-buffer pattern).
   * Avoids redundant DB lookups for the common case where the same payment
   * is delivered twice by the stream.
   */
  private processedTxHashes = new Set<string>();
  private readonly MAX_DEDUP_CACHE_SIZE = 10_000;

  // ── Memo pattern ────────────────────────────────────────────────────────────
  /** Matches memo text of the form `DEAL-<uuid-or-id>-INV-<uuid>` */
  private static readonly MEMO_PATTERN =
    /^DEAL-([^-](?:[^-]|-(?!INV-))*)-INV-([a-f0-9-]+)$/i;

  constructor(
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
    @InjectRepository(AccountMergeRecovery)
    private readonly mergeRecoveryRepo: Repository<AccountMergeRecovery>,
    @InjectRepository(UnrecognisedPayment)
    private readonly unrecognisedPaymentRepo: Repository<UnrecognisedPayment>,
    private readonly stellarService: StellarService,
    private readonly investmentsService: InvestmentsService,
    @InjectMetric('stellar_payments_received_total')
    private readonly paymentsReceivedCounter: Counter<string>,
    @InjectMetric('stellar_payments_unmatched_total')
    private readonly paymentsUnmatchedCounter: Counter<string>,
  ) {
    this.logger.setContext(StellarMonitorService.name);
    const horizonUrl = this.config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new Horizon.Server(horizonUrl);

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

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  onModuleInit(): void {
    // Graceful no-op if no platform account is configured.
    if (!this.platformAccountId) {
      this.logger.warn(
        'STELLAR_PLATFORM_SECRET not configured — payment streaming disabled.',
      );
      return;
    }
    void this.startPaymentStream();
  }

  onModuleDestroy(): void {
    if (this.paymentStream) {
      try {
        this.paymentStream();
      } catch {
        // ignore errors during shutdown
      }
      this.paymentStream = null;
      this.logger.log('Payment stream closed on module destroy.');
    }
  }

  // ── Payment streaming (Issue #905) ─────────────────────────────────────────

  /**
   * Opens a Horizon SSE payment stream for the platform account.
   * Sets `this.paymentStream` to the close-handle returned by the SDK.
   * On error, delegates to `scheduleReconnect()` for exponential back-off.
   */
  private async startPaymentStream(): Promise<void> {
    if (!this.platformAccountId) return;

    try {
      this.logger.log(
        { account: this.platformAccountId },
        'Starting Stellar payment stream',
      );

      // The stellar-sdk streaming API returns a close function.
      this.paymentStream = this.server
        .payments()
        .forAccount(this.platformAccountId)
        .stream({
          onmessage: (payment: any) => {
            void this.handleIncomingPayment(payment);
          },
          onerror: (_err: any) => {
            this.logger.warn('Payment stream error — scheduling reconnect');
            this.scheduleReconnect();
          },
        }) as unknown as () => void;

      this.logger.log('Stellar payment stream established successfully.');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to start payment stream — scheduling reconnect',
      );
      this.scheduleReconnect();
    }
  }

  /**
   * Schedules a reconnect attempt with exponential back-off capped at 5 min.
   * Stops after MAX_RECONNECT_ATTEMPTS and sends a critical ops alert.
   */
  private scheduleReconnect(): void {
    if (this.streamReconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        { attempts: this.streamReconnectAttempts },
        'Payment stream max reconnect attempts reached — manual intervention required.',
      );
      void this.sendAlert(
        '🚨 CRITICAL: Stellar payment stream offline',
        `Payment stream could not reconnect after ${this.MAX_RECONNECT_ATTEMPTS} attempts on account ${this.platformAccountId}. Manual intervention required.`,
      );
      return;
    }

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS *
        Math.pow(2, this.streamReconnectAttempts),
      5 * 60 * 1000, // cap at 5 minutes
    );

    this.streamReconnectAttempts += 1;

    this.logger.warn(
      { attempt: this.streamReconnectAttempts, delayMs: delay },
      `Scheduling payment stream reconnect in ${delay}ms`,
    );

    setTimeout(() => {
      void this.startPaymentStream();
    }, delay);
  }

  /**
   * Processes a single payment event from the Horizon stream (or the polling
   * fallback).  Implements in-memory and DB-backed deduplication.
   */
  async handleIncomingPayment(payment: any): Promise<void> {
    // A successful delivery means the stream is alive — reset the counter.
    this.streamReconnectAttempts = 0;

    // ── 1. Extract a stable transaction identifier ───────────────────────────
    const txHash: string =
      payment.transaction_hash ?? payment.id ?? String(payment.paging_token);

    // ── 2. In-memory dedup (fast path) ────────────────────────────────────────
    if (this.processedTxHashes.has(txHash)) {
      return;
    }

    // ── 3. Add to dedup cache (evict oldest entry when full) ──────────────────
    if (this.processedTxHashes.size >= this.MAX_DEDUP_CACHE_SIZE) {
      const oldest = this.processedTxHashes.values().next().value;
      if (oldest !== undefined) {
        this.processedTxHashes.delete(oldest);
      }
    }
    this.processedTxHashes.add(txHash);

    // ── 4. DB dedup: skip if already in unrecognised_payments ─────────────────
    const existing = await this.unrecognisedPaymentRepo.findOne({
      where: { stellarTxHash: txHash },
    });
    if (existing) {
      return;
    }

    // ── 5. Update Prometheus counter ──────────────────────────────────────────
    const assetLabel = payment.asset_code ?? 'XLM';
    this.paymentsReceivedCounter.inc({ asset: assetLabel });

    // ── 6. Resolve memo ───────────────────────────────────────────────────────
    let memo: string | null = null;

    // The stream record sometimes embeds transaction attributes inline.
    if (payment.transaction?.memo) {
      memo = String(payment.transaction.memo);
    } else if (payment.memo) {
      memo = String(payment.memo);
    } else if (payment.transaction_hash) {
      // Fetch the parent transaction to retrieve the memo.
      try {
        const tx = await this.server
          .transactions()
          .transaction(payment.transaction_hash)
          .call();
        if ((tx as any).memo) {
          memo = String((tx as any).memo);
        }
      } catch (fetchErr: any) {
        this.logger.warn(
          { txHash, error: fetchErr.message },
          'Could not fetch transaction memo',
        );
      }
    }

    // ── 7. Match memo to investment ───────────────────────────────────────────
    if (memo) {
      const match = StellarMonitorService.MEMO_PATTERN.exec(memo);
      if (match) {
        const investmentId = match[2];
        try {
          await this.investmentsService.confirmPaymentFromStream(
            investmentId,
            txHash,
            String(payment.amount ?? '0'),
          );
          this.logger.info(
            { investmentId, txHash },
            'Investment confirmed via payment stream',
          );
          return;
        } catch (err: any) {
          this.logger.error(
            { investmentId, txHash, error: err.message },
            'confirmPaymentFromStream failed — recording as unrecognised',
          );
          // Fall through to record as unrecognised so ops can investigate.
        }
      }
    }

    // ── 8. Unmatched payment ──────────────────────────────────────────────────
    await this.recordUnrecognisedPayment(payment, txHash, memo);
  }

  /**
   * Persists an unmatched payment and fires an ops alert.
   */
  private async recordUnrecognisedPayment(
    payment: any,
    txHash: string,
    memo: string | null,
  ): Promise<void> {
    try {
      const record = this.unrecognisedPaymentRepo.create({
        stellarTxHash: txHash,
        fromAccount: payment.from ?? payment.source_account ?? 'unknown',
        amount: String(payment.amount ?? '0'),
        assetCode: payment.asset_code ?? null,
        assetIssuer: payment.asset_issuer ?? null,
        memo,
        rawRecord: payment,
        alertedAt: new Date(),
      });

      await this.unrecognisedPaymentRepo.save(record);
    } catch (saveErr: any) {
      // A unique-constraint violation means another worker already saved it.
      if (saveErr?.code === '23505') {
        this.logger.debug(
          { txHash },
          'Unrecognised payment already persisted (concurrent insert)',
        );
        return;
      }
      this.logger.error(
        { txHash, error: saveErr.message },
        'Failed to persist unrecognised payment',
      );
    }

    this.paymentsUnmatchedCounter.inc();

    this.logger.warn(
      { txHash, memo, amount: payment.amount, asset: payment.asset_code },
      'Unrecognised Stellar payment received — ops alert sent',
    );

    await this.sendAlert(
      '⚠️ Unrecognised Stellar Payment',
      `Received a payment on the platform account that could not be matched to any investment.\n\n` +
        `• TX Hash: \`${txHash}\`\n` +
        `• From: ${payment.from ?? payment.source_account ?? 'unknown'}\n` +
        `• Amount: ${payment.amount} ${payment.asset_code ?? 'XLM'}\n` +
        `• Memo: ${memo ?? '(none)'}`,
    );
  }

  // ── Polling fallback (Issue #905) ──────────────────────────────────────────

  /**
   * Runs every 60 seconds as a catch-all for payments missed while the SSE
   * stream was reconnecting.  Fetches the 50 most-recent payments and passes
   * each one through `handleIncomingPayment` — the in-memory cache prevents
   * double-processing for payments already handled by the stream.
   */
  @Cron('*/60 * * * * *')
  async pollMissedPayments(): Promise<void> {
    if (!this.platformAccountId) return;

    try {
      const response = await this.server
        .payments()
        .forAccount(this.platformAccountId)
        .order('desc')
        .limit(50)
        .call();

      const records: any[] = response.records ?? [];

      for (const payment of records) {
        const txHash: string =
          payment.transaction_hash ??
          payment.id ??
          String(payment.paging_token);
        if (this.processedTxHashes.has(txHash)) {
          // Already processed — skip quickly without additional I/O.
          continue;
        }
        await this.handleIncomingPayment(payment);
      }
    } catch (err: any) {
      this.logger.warn(
        { error: err.message },
        'pollMissedPayments failed',
      );
    }
  }

  // ── Balance monitoring (existing, Issue #359) ───────────────────────────────

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

      const nativeBalanceStr =
        account.balances.find((b) => b.asset_type === 'native')?.balance || '0';
      const nativeBalance = parseFloat(nativeBalanceStr);

      const sequenceNumber = BigInt(account.sequenceNumber());
      const subentryCount = account.subentry_count || 0;

      const transactions = await this.fetchRecentTransactions();
      const feeMetrics = this.analyzeFeeMetrics(transactions);

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

      if (nativeBalance < this.BALANCE_THRESHOLD_XLM) {
        await this.triggerLowBalanceAlert(nativeBalance, feeMetrics);
      } else if (this.lastAlertTime > 0) {
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
   */
  private analyzeFeeMetrics(
    transactions: Array<{ fee_charged: string; created_at: string }>,
  ): {
    avgFeeXlm: number;
    totalFeesXlm: number;
    projectedMonthlyBurnXlm: number;
  } {
    if (transactions.length === 0) {
      return { avgFeeXlm: 0, totalFeesXlm: 0, projectedMonthlyBurnXlm: 0 };
    }

    const feesInXlm = transactions.map(
      (tx) => parseFloat(tx.fee_charged) / 10_000_000,
    );
    const totalFeesXlm = feesInXlm.reduce((sum, fee) => sum + fee, 0);
    const avgFeeXlm = totalFeesXlm / transactions.length;

    const oldestTx = transactions[transactions.length - 1];
    const newestTx = transactions[0];
    const timeSpanMs =
      new Date(newestTx.created_at).getTime() -
      new Date(oldestTx.created_at).getTime();
    const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);

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
      embeds: [
        {
          title: '🚨 CRITICAL: Stellar Platform Wallet Balance Low',
          description: `The platform wallet is running low on XLM and needs immediate funding.`,
          color: 16711680,
          fields: [
            { name: 'Current Balance', value: `${balance} XLM`, inline: true },
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
          footer: { text: 'Stellar Balance Monitor' },
          timestamp: new Date().toISOString(),
        },
      ],
      text: `🚨 CRITICAL: Stellar Platform Account has low balance of ${balance} XLM (threshold: ${this.BALANCE_THRESHOLD_XLM} XLM). Projected monthly burn: ${feeMetrics.projectedMonthlyBurnXlm} XLM. Please fund wallet: ${this.platformAccountId}`,
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
      this.lastAlertTime = now;
    }
  }

  /**
   * Generic alert helper used by payment-stream error paths.
   */
  private async sendAlert(title: string, body: string): Promise<void> {
    const webhookUrl = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(
        { title },
        'ALERT_WEBHOOK_URL not configured — skipping alert',
      );
      return;
    }
    try {
      await axios.post(webhookUrl, {
        embeds: [
          {
            title,
            description: body,
            color: 16776960, // Yellow
            timestamp: new Date().toISOString(),
          },
        ],
        text: `${title}\n${body}`,
      });
    } catch (err: any) {
      this.logger.error(
        { title, error: err.message },
        'Failed to send webhook alert',
      );
    }
  }

  // ── Account merge detection (existing, Issue #683) ──────────────────────────

  /**
   * Detects Stellar account merge operations every 5 minutes.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectAccountMerges() {
    this.logger.log('Starting account merge detection...');

    try {
      const pendingMerges = await this.mergeRecoveryRepo.find({
        where: [{ status: 'detected' }, { status: 'replacement_created' }],
      });

      this.logger.debug(
        { count: pendingMerges.length },
        'Found pending merge recovery records',
      );

      for (const mergeRecord of pendingMerges) {
        await this.attemptMergeRecovery(mergeRecord);
      }

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

  private async processAccountMergeTx(tx: any): Promise<void> {
    const mergeOps = tx.operations.filter(
      (op: any) => op.type === 'account_merge',
    );

    for (const op of mergeOps) {
      const originalPublicKey = op.source_account || tx.source_account;
      const mergedPublicKey = op.into;

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

  private async attemptMergeRecovery(
    recovery: AccountMergeRecovery,
  ): Promise<void> {
    try {
      if (recovery.status === 'detected') {
        const { publicKey, secretKey } =
          await this.stellarService.createReplacementAccount();

        recovery.replacementPublicKey = publicKey;
        recovery.replacementSecretKeyEncrypted =
          await this.stellarService.encryptSecret(secretKey);
        recovery.status = 'replacement_created';

        await this.mergeRecoveryRepo.save(recovery);

        this.logger.info(
          { recoveryId: recovery.id, replacementPublicKey: publicKey },
          'Replacement account created for merge recovery',
        );
      }

      if (
        recovery.status === 'replacement_created' &&
        recovery.replacementPublicKey
      ) {
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
          color: 16711680,
          fields: [
            { name: 'Recovery ID', value: recovery.id, inline: true },
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
            { name: 'Last Error', value: error.message, inline: false },
            {
              name: 'Attempts',
              value: recovery.paymentRetryAttempts.toString(),
              inline: true,
            },
          ],
          footer: { text: 'Stellar Account Merge Monitor' },
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
