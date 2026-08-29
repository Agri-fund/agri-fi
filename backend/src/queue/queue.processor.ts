import { Controller, OnApplicationShutdown } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { StellarService } from '../stellar/stellar.service';
import { SorobanService } from '../soroban/soroban.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment, InvestmentStatus } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  EmailTemplateService,
  RenderedEmail,
} from '../notifications/email-template.service';
import {
  DealPublishPayload,
  InvestmentFundPayload,
  DealFundedPayload,
  DealCleanupPayload,
  BasePayload,
} from './queue.service';
import {
  DEFAULT_QUEUE_MAX_RETRIES,
  getExponentialBackoffDelayMs,
  getDeliveryAttempt,
} from './retry-policy';
import { decryptPayload } from './queue.crypto';
import { IdempotencyService } from './idempotency.service';

@Controller()
export class QueueProcessor implements OnApplicationShutdown {
  /**
   * Tracks all in-flight handler promises so onApplicationShutdown can await
   * them before the process exits, satisfying #696.
   */
  private readonly activeJobs = new Set<Promise<void>>();

  /** Set to true once shutdown is signalled — new messages are nacked. */
  private shuttingDown = false;

  constructor(
    private readonly stellarService: StellarService,
    private readonly sorobanService: SorobanService,
    private readonly tradeDealsService: TradeDealsService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly logger: PinoLogger,
    private readonly idempotency: IdempotencyService,
  ) {
    this.logger.setContext(QueueProcessor.name);
  }

  // ── Shutdown hook (#696) ────────────────────────────────────────────────────

  /**
   * Called by NestJS when the application receives a shutdown signal
   * (SIGTERM/SIGINT). Stops accepting new messages and waits for all
   * in-flight handlers to complete before allowing the process to exit.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    this.logger.info(
      { signal, inflightCount: this.activeJobs.size },
      'QueueProcessor shutting down — waiting for in-flight jobs to complete',
    );

    if (this.activeJobs.size > 0) {
      await Promise.allSettled(Array.from(this.activeJobs));
    }

    this.logger.info('QueueProcessor shutdown complete — all jobs finished');
  }

  /**
   * Wraps a handler body so it is tracked in activeJobs and graceful-shutdown
   * aware.  Returns immediately (nacks) if shutting down.
   */
  private track(
    fn: () => Promise<void>,
    channel: any,
    msg: any,
    pattern: string,
  ): void {
    if (this.shuttingDown) {
      // Return the message to the queue safely — it will be reprocessed
      // by the next healthy replica.
      this.logger.warn(
        { event: pattern },
        `${pattern} received during shutdown — requeueing message`,
      );
      channel.nack(msg, false, true);
      return;
    }

    const job = fn().finally(() => this.activeJobs.delete(job));
    this.activeJobs.add(job);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private setCorrelationId(payload: BasePayload): void {
    if (payload.correlationId) {
      this.logger.assign({ correlationId: payload.correlationId });
    }
  }

  private truncate(value: string, max = 500): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }

  private correlationIdFromMessage(msg: any): string | undefined {
    return msg?.properties?.correlationId;
  }

  private unwrap<T>(
    encrypted: string,
    pattern: string,
    channel: any,
    msg: any,
  ): T | null {
    try {
      return decryptPayload<T>(encrypted);
    } catch (err: any) {
      this.logger.error(
        {
          event: pattern,
          error: err.message,
          correlationId: this.correlationIdFromMessage(msg),
          rawMessage: this.truncate(String(encrypted ?? '')),
        },
        `${pattern} decryption failed — routing to DLQ`,
      );
      // Undecryptable payloads can never succeed on retry — send straight to DLQ.
      channel.nack(msg, false, false);
      return null;
    }
  }

  /**
   * Nack a message that failed processing. Requeues while under
   * MAX_DELIVERY_ATTEMPTS so the broker's retry/backoff can kick in; once
   * exhausted, nacks without requeue so RabbitMQ dead-letters it to the
   * queue's configured DLX (see queue.dlq.constants.ts).
   */
  private nackWithRetryLimit(
    channel: any,
    msg: any,
    pattern: string,
    context: Record<string, unknown>,
  ): void {
    const attempt = getDeliveryAttempt(msg);
    const exhausted = attempt >= DEFAULT_QUEUE_MAX_RETRIES;

    this.logger.warn(
      {
        ...context,
        event: pattern,
        attempt,
        maxRetries: DEFAULT_QUEUE_MAX_RETRIES,
      },
      exhausted
        ? `${pattern} exhausted ${DEFAULT_QUEUE_MAX_RETRIES} attempts — routing to DLQ`
        : `${pattern} attempt ${attempt}/${DEFAULT_QUEUE_MAX_RETRIES} failed — requeueing`,
    );

    channel.nack(msg, false, !exhausted);
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  @EventPattern('deal.publish')
  handleDealPublish(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.track(
      () => this.processDealPublish(encrypted, channel, originalMsg),
      channel,
      originalMsg,
      'deal.publish',
    );
  }

  private async processDealPublish(
    encrypted: string,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const data = this.unwrap<DealPublishPayload>(
      encrypted,
      'deal.publish',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);

    // ── Idempotency check (#687) ───────────────────────────────────────────
    const idemKey = IdempotencyService.buildKey('deal.publish', data.dealId);
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { dealId: data.dealId, status: lease.status },
        'deal.publish duplicate — acking without reprocessing',
      );
      channel.ack(originalMsg);
      return;
    }

    this.logger.info(
      { dealId: data.dealId },
      `Processing deal.publish for deal ${data.dealId}`,
    );

    try {
      // Call StellarService.issueTradeToken
      const escrowSecretKey = await this.stellarService.decryptSecret(
        data.encryptedEscrowSecret,
      );
      const result = await this.stellarService.issueTradeToken(
        data.tokenSymbol,
        data.escrowPublicKey,
        escrowSecretKey,
        data.tokenCount,
      );

      // Encrypt the issuer secret
      const encryptedIssuerSecret = await this.stellarService.encryptSecret(
        result.issuerSecret,
      );
      if (encryptedIssuerSecret === result.issuerSecret) {
        throw new Error('Issuer secret encryption failed');
      }

      // Update deal with issuer keys and status to open
      const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
      await this.tradeDealRepo.update(data.dealId, {
        status: 'open',
        appTraceId,
        stellarAssetTxId: result.txId,
        issuerPublicKey: result.issuerPublicKey,
        issuerSecretKey: encryptedIssuerSecret,
      });

      // Initialize Soroban FarmCampaign contract (non-blocking)
      this.initSorobanCampaign(data.dealId, data.escrowPublicKey).catch(
        (e: any) =>
          this.logger.warn(
            { dealId: data.dealId, error: e.message },
            'Soroban init skipped',
          ),
      );

      this.logger.info(
        { dealId: data.dealId, txId: result.txId },
        `Successfully published deal ${data.dealId} with txId ${result.txId}`,
      );

      await this.idempotency.markDone(idemKey);
    } catch (error) {
      this.logger.error(
        { dealId: data.dealId, error: error.message },
        `Failed to publish deal ${data.dealId}: ${error.message}`,
      );

      // On Stellar failure: mark deal status = 'failed'
      const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
      await this.tradeDealRepo.update(data.dealId, {
        status: 'failed',
        appTraceId,
      });

      // Release idempotency lease so retry can re-acquire
      await this.idempotency.releaseLease(idemKey);

      this.nackWithRetryLimit(channel, originalMsg, 'deal.publish', {
        dealId: data.dealId,
      });
      return;
    }

    // Acknowledge the message
    channel.ack(originalMsg);
  }

  @EventPattern('investment.fund')
  handleInvestmentFund(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.track(
      () => this.processInvestmentFund(encrypted, channel, originalMsg),
      channel,
      originalMsg,
      'investment.fund',
    );
  }

  private async processInvestmentFund(
    encrypted: string,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const data = this.unwrap<InvestmentFundPayload>(
      encrypted,
      'investment.fund',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);

    // ── Idempotency check (#687) ───────────────────────────────────────────
    const idemKey = IdempotencyService.buildKey(
      'investment.fund',
      data.investmentId,
    );
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { investmentId: data.investmentId, status: lease.status },
        'investment.fund duplicate — acking without reprocessing',
      );
      channel.ack(originalMsg);
      return;
    }

    // #788 — the investor may have cancelled during the cooling-off window
    // between when this job was enqueued and now. Refuse to submit a real
    // on-chain transfer for an investment that is no longer PENDING, rather
    // than blindly overwriting whatever status a cancel (or any other path)
    // already set.
    const current = await this.investmentRepo.findOne({
      where: { id: data.investmentId },
    });
    if (!current || current.status !== InvestmentStatus.PENDING) {
      this.logger.info(
        { investmentId: data.investmentId, status: current?.status },
        'investment.fund skipped — investment is no longer pending (likely cancelled)',
      );
      channel.ack(originalMsg);
      return;
    }

    this.logger.info(
      { investmentId: data.investmentId },
      `Processing investment.fund for investment ${data.investmentId}`,
    );

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < DEFAULT_QUEUE_MAX_RETRIES) {
      try {
        // Submit the investor-signed XDR to Stellar
        const result = await this.stellarService.submitTransaction(
          data.signedXdr,
        );
        const stellarTxId: string = result.hash;

        // Transfer Trade_Tokens from escrow account to investor wallet.
        const escrowSecret = await this.stellarService.decryptSecret(
          data.encryptedEscrowSecret,
        );
        await this.stellarService.transferTradeTokens(
          escrowSecret,
          data.escrowPublicKey,
          data.investorWallet,
          data.assetCode,
          data.tokenAmount,
        );

        // Confirm investment and increment total_invested
        await this.investmentRepo.update(data.investmentId, {
          status: 'confirmed' as any,
          stellarTxId,
        });

        this.logger.info(
          { investmentId: data.investmentId, txId: stellarTxId },
          `Successfully funded investment ${data.investmentId} with txId ${stellarTxId}`,
        );

        await this.idempotency.markDone(idemKey);
        channel.ack(originalMsg);
        return;
      } catch (error) {
        attempt++;
        lastError = error;
        this.logger.warn(
          {
            investmentId: data.investmentId,
            attempt,
            maxRetries: DEFAULT_QUEUE_MAX_RETRIES,
            error: error.message,
          },
          `investment.fund attempt ${attempt}/${DEFAULT_QUEUE_MAX_RETRIES} failed for ${data.investmentId}: ${error.message}`,
        );

        if (attempt < DEFAULT_QUEUE_MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, getExponentialBackoffDelayMs(attempt, 500)),
          );
        }
      }
    }

    // In-process retries exhausted — mark investment as failed and release lease
    this.logger.error(
      {
        investmentId: data.investmentId,
        maxRetries: DEFAULT_QUEUE_MAX_RETRIES,
        error: lastError?.message,
      },
      `investment.fund permanently failed for ${data.investmentId} after ${DEFAULT_QUEUE_MAX_RETRIES} attempts: ${lastError?.message}`,
    );
    await this.investmentRepo.update(data.investmentId, {
      status: 'failed' as any,
    });

    await this.idempotency.releaseLease(idemKey);
    channel.nack(originalMsg, false, false);
  }

  @EventPattern('deal.funded')
  handleDealFunded(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.track(
      () => this.processDealFunded(encrypted, channel, originalMsg),
      channel,
      originalMsg,
      'deal.funded',
    );
  }

  private async processDealFunded(
    encrypted: string,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const data = this.unwrap<DealFundedPayload>(
      encrypted,
      'deal.funded',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);

    // ── Idempotency check (#687) ───────────────────────────────────────────
    const idemKey = IdempotencyService.buildKey(
      'deal.funded',
      data.tradeDealId,
    );
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { tradeDealId: data.tradeDealId, status: lease.status },
        'deal.funded duplicate — acking without reprocessing',
      );
      channel.ack(originalMsg);
      return;
    }

    this.logger.info(
      { tradeDealId: data.tradeDealId },
      `Processing deal.funded for deal ${data.tradeDealId}`,
    );

    try {
      for (const investor of data.investors) {
        await this.notificationsService.sendEmail(
          investor.email,
          `Deal Fully Funded: ${data.commodity}`,
          `Good news! The deal for ${data.commodity} you invested in (Deal ID: ${data.tradeDealId}) is now fully funded. You invested ${investor.tokenAmount} tokens.`,
          `<h3>Deal Fully Funded</h3><p>Good news! The deal for <strong>${data.commodity}</strong> you invested in (Deal ID: ${data.tradeDealId}) is now fully funded.</p><p>You invested ${investor.tokenAmount} tokens.</p>`,
        );
      }
      await this.idempotency.markDone(idemKey);
    } catch (e: any) {
      this.logger.error(
        { error: e.message },
        `Failed to send deal.funded notifications: ${e.message}`,
      );
      // Notification failures are non-critical — release lease and ack anyway
      // so the deal record is not stuck; alerts go via queue-alert service.
      await this.idempotency.releaseLease(idemKey);
    }

    channel.ack(originalMsg);
  }

  @EventPattern('email.notification')
  handleEmailNotification(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.track(
      () => this.processEmailNotification(encrypted, channel, originalMsg),
      channel,
      originalMsg,
      'email.notification',
    );
  }

  private async processEmailNotification(
    encrypted: string,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const data = this.unwrap<any>(
      encrypted,
      'email.notification',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);

    // Derive a stable idempotency key: prefer an explicit messageId on the
    // payload; fall back to userId+type for notification events.
    const businessId =
      data.messageId ??
      `${data.userId ?? 'unknown'}-${data.type ?? 'unknown'}`;
    const idemKey = IdempotencyService.buildKey(
      'email.notification',
      businessId,
    );
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { businessId, status: lease.status },
        'email.notification duplicate — acking without reprocessing',
      );
      channel.ack(originalMsg);
      return;
    }

    this.logger.info(
      { type: data.type },
      `Processing email.notification of type ${data.type}`,
    );

    try {
      let emailAddress = data.email;
      let user: User | null = null;
      if (!emailAddress && data.userId) {
        user = await this.userRepo.findOne({
          where: { id: data.userId },
        });
        if (user) {
          emailAddress = user.email;
        }
      } else if (data.userId) {
        // Localised emails need the user's preferred language (#897)
        user = await this.userRepo.findOne({ where: { id: data.userId } });
      }

      if (emailAddress) {
        const templateName = EMAIL_TYPE_TO_TEMPLATE[data.type];
        if (templateName) {
          const rendered = this.renderLocalized(templateName, data, user);
          await this.notificationsService.sendEmail(
            emailAddress,
            rendered.subject,
            rendered.text,
            rendered.html,
          );
        } else {
          const { subject, text, html } = this.buildLegacyNotification(data);
          if (subject) {
            await this.notificationsService.sendEmail(
              emailAddress,
              subject,
              text,
              html,
            );
          }
        }
      } else {
        this.logger.warn(
          { userId: data.userId },
          'No email address found for user notification',
        );
      }

      await this.idempotency.markDone(idemKey);
    } catch (e: any) {
      this.logger.error(
        { error: e.message },
        `Failed to send email.notification: ${e.message}`,
      );
      await this.idempotency.releaseLease(idemKey);
    }

    channel.ack(originalMsg);
  }

  /**
   * Renders a localized template for an `email.notification` payload using
   * the recipient's preferred language, falling back to English (#897).
   */
  private renderLocalized(
    templateName: string,
    data: any,
    user: User | null,
  ): RenderedEmail {
    const details = data.dealDetails ?? {};
    const displayName =
      data.userName ??
      details.farmerName ??
      details.investorName ??
      (user?.fullName ?? deriveNameFromEmail(user?.email ?? data.email ?? ''));

    const vars: Record<string, unknown> = {
      userName: displayName,
      farmerName: displayName,
      investorName: displayName,
      leadFarmerName: details.leadFarmerName ?? displayName,
      dealName: details.commodity ?? data.commodity ?? details.dealName,
      amount: formatUsd(details.amount ?? data.amount),
      farmerAmount: formatUsd(details.farmerAmount),
      returnAmount: formatUsd(details.returnAmount),
      investmentAmount: formatUsd(details.investmentAmount),
      tokenAmount: details.tokenAmount ?? data.tokenAmount,
      txId: data.stellarTxId ?? details.stellarTxId ?? '',
      unlockAt: data.unlockAt ?? '',
      ipAddress: data.ipAddress ?? '',
      device: data.device ?? '',
      time: data.time ?? new Date().toISOString(),
      verifyUrl: data.verifyUrl ?? '',
      resetUrl: data.resetUrl ?? '',
      expiresInMinutes: data.expiresInMinutes ?? 30,
      acceptUrl: data.acceptUrl ?? '',
      portionPercent: details.portionPercent ?? data.portionPercent ?? '',
      reason: details.reason ?? data.reason ?? '',
      kycUrl: `${this.config.get<string>('APP_BASE_URL', 'http://localhost:3001')}/dashboard/kyc`,
      // #808 — PDF receipt download link in payment confirmation emails.
      // Populated when the receipt has already been generated and the S3
      // pre-signed URL has been embedded in the notification payload.
      receiptUrl: data.receiptUrl ?? details.receiptUrl ?? undefined,
      ...details,
    };

    return this.emailTemplates.render(
      templateName,
      vars,
      user?.preferredLanguage,
    );
  }

  /** Legacy inline copy for event types without localized templates yet. */
  private buildLegacyNotification(data: any): {
    subject: string;
    text: string;
    html: string;
  } {
    if (data.type === 'kyc_expiration_30') {
      return {
        subject: 'KYC Document Expiring in 30 Days',
        text: `Your KYC documents will expire in 30 days. Please update them to continue using our services.`,
        html: `<h3>KYC Documents Expiring Soon</h3><p>Your KYC documents will expire in 30 days. Please update them to continue using our services.</p>`,
      };
    }
    if (data.type === 'kyc_expiration_15') {
      return {
        subject: 'KYC Document Expiring in 15 Days',
        text: `Your KYC documents will expire in 15 days. Please update them to continue using our services.`,
        html: `<h3>KYC Documents Expiring Soon</h3><p>Your KYC documents will expire in 15 days. Please update them to continue using our services.</p>`,
      };
    }
    if (data.type === 'kyc_expiration_3') {
      return {
        subject: 'KYC Document Expiring in 3 Days',
        text: `Your KYC documents will expire in 3 days. Please update them immediately to continue using our services.`,
        html: `<h3>KYC Documents Expiring Soon</h3><p>Your KYC documents will expire in 3 days. Please update them immediately to continue using our services.</p>`,
      };
    }
    if (data.type === 'kyc_expired') {
      return {
        subject: 'KYC Documents Expired',
        text: `Your KYC documents have expired. Your account has been restricted. Please update your documents to restore access.`,
        html: `<h3>KYC Documents Expired</h3><p>Your KYC documents have expired. Your account has been restricted. Please update your documents to restore access.</p>`,
      };
    }
    if (data.type === 'deal_completed') {
      let subject = `Deal Completed: ${data.dealDetails?.commodity}`;
      let text = `The deal you participated in (${data.dealDetails?.commodity}) has been completed.`;
      let html = `<h3>Deal Completed</h3><p>The deal you participated in (<strong>${data.dealDetails?.commodity}</strong>) has been completed.</p>`;

      if (data.recipient === 'investor') {
        text += `\nYour return: $${data.dealDetails?.returnAmount?.toFixed(2)}`;
        html += `<p>Your return: $${data.dealDetails?.returnAmount?.toFixed(2)}</p>`;
      } else if (data.recipient === 'farmer') {
        text += `\nYour payout: $${data.dealDetails?.farmerAmount?.toFixed(2)}`;
        html += `<p>Your payout: $${data.dealDetails?.farmerAmount?.toFixed(2)}</p>`;
      }
      return { subject, text, html };
    }
    return { subject: '', text: '', html: '' };
  }

  @EventPattern('deal.cleanup')
  handleDealCleanup(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.track(
      () => this.processDealCleanup(encrypted, channel, originalMsg),
      channel,
      originalMsg,
      'deal.cleanup',
    );
  }

  private async processDealCleanup(
    encrypted: string,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const data = this.unwrap<DealCleanupPayload>(
      encrypted,
      'deal.cleanup',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);

    // ── Idempotency check (#687) ───────────────────────────────────────────
    const idemKey = IdempotencyService.buildKey(
      'deal.cleanup',
      data.tradeDealId,
    );
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { tradeDealId: data.tradeDealId, status: lease.status },
        'deal.cleanup duplicate — acking without reprocessing',
      );
      channel.ack(originalMsg);
      return;
    }

    this.logger.info(
      { dealId: data.tradeDealId },
      `Processing deal.cleanup for deal ${data.tradeDealId}`,
    );

    try {
      const deal = await this.tradeDealsService.findOne(data.tradeDealId);
      if (!deal) {
        this.logger.warn(`Deal ${data.tradeDealId} not found for cleanup`);
        await this.idempotency.markDone(idemKey);
        channel.ack(originalMsg);
        return;
      }

      const platformWallet = this.config.get<string>(
        'STELLAR_PLATFORM_WALLET',
        this.config.get<string>('STELLAR_PLATFORM_SECRET', ''),
      );

      if (!platformWallet) {
        throw new Error('Platform wallet address not configured');
      }

      // Cleanup escrow account
      if (deal.escrowPublicKey && deal.escrowSecretKey) {
        try {
          const escrowSecret = await this.stellarService.decryptSecret(
            deal.escrowSecretKey,
          );
          await this.stellarService.closeAccount(
            deal.escrowPublicKey,
            escrowSecret,
            platformWallet,
          );
        } catch (error) {
          this.logger.error(
            { dealId: data.tradeDealId, error: error.message },
            `Failed to cleanup escrow for deal ${data.tradeDealId}`,
          );
        }
      }

      // Cleanup issuer account
      if (deal.issuerPublicKey && deal.issuerSecretKey) {
        try {
          const issuerSecret = await this.stellarService.decryptSecret(
            deal.issuerSecretKey,
          );
          await this.stellarService.closeAccount(
            deal.issuerPublicKey,
            issuerSecret,
            platformWallet,
          );
        } catch (error) {
          this.logger.error(
            { dealId: data.tradeDealId, error: error.message },
            `Failed to cleanup issuer for deal ${data.tradeDealId}`,
          );
        }
      }

      this.logger.info(
        { dealId: data.tradeDealId },
        `Successfully completed deal cleanup for deal ${data.tradeDealId}`,
      );

      await this.idempotency.markDone(idemKey);
    } catch (error) {
      this.logger.error(
        { dealId: data.tradeDealId, error: error.message },
        `Deal cleanup failed for deal ${data.tradeDealId}: ${error.message}`,
      );
      // Best-effort cleanup — still release lease and ack
      await this.idempotency.releaseLease(idemKey);
    }

    channel.ack(originalMsg);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Initializes a Soroban FarmCampaign contract after a deal goes live.
   * Non-blocking — called with .catch() so failures don't affect the deal.
   */
  private async initSorobanCampaign(
    dealId: string,
    adminAddress: string,
  ): Promise<void> {
    const factoryContractId = this.config.get<string>(
      'SOROBAN_FACTORY_CONTRACT_ID',
    );
    const sorobanRpcUrl = this.config.get<string>('SOROBAN_RPC_URL');
    if (!factoryContractId || !sorobanRpcUrl) return;

    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['farmer'],
    });
    if (!deal?.farmer?.walletAddress) return;

    const usdcContractId = this.config.get<string>(
      'USDC_CONTRACT_ID',
      this.config.get<string>('USDC_ISSUER', ''),
    );
    if (!usdcContractId) return;

    const deadlineTs = Math.floor(new Date(deal.deliveryDate).getTime() / 1000);
    const fundingTargetStroops = BigInt(
      Math.round(Number(deal.totalValue) * 1e7),
    );

    const txHash = await this.sorobanService.initializeCampaign(
      factoryContractId,
      {
        admin: adminAddress,
        farmer: deal.farmer.walletAddress,
        usdcToken: usdcContractId,
        fundingTarget: fundingTargetStroops,
        deadline: deadlineTs,
        platformFeeBps: 200,
        milestoneCount: 4,
        projectName: deal.commodity,
        commodity: deal.commodity,
      },
    );

    await this.tradeDealRepo.update(dealId, {
      sorobanCampaignContractId: factoryContractId,
      sorobanFactoryTxHash: txHash,
    });

    this.logger.info({ dealId, txHash }, 'Soroban FarmCampaign initialized');
  }
}

/**
 * Maps `email.notification` event types to localized template names (#897).
 * Types absent from this map keep their legacy inline copy.
 */
const EMAIL_TYPE_TO_TEMPLATE: Record<string, string> = {
  welcome: 'welcome',
  kyc_verified: 'kyc-approved',
  kyc_rejected: 'kyc-rejected',
  investment_confirmed: 'investment-confirmed',
  payment_distributed: 'payment-distributed',
  deal_funded: 'deal-funded',
  deal_expired: 'deal-expired',
  password_reset: 'password-reset',
  account_lockout: 'account-lockout',
  security_alert_new_device: 'security-alert',
  co_farmer_invitation: 'co-farmer-invitation',
};

function formatUsd(value: unknown): string {
  const num = Number(value);
  if (value === null || value === undefined || Number.isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function deriveNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  if (!local) return 'there';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
