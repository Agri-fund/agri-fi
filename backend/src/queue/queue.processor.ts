import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { StellarService } from '../stellar/stellar.service';
import { SorobanService } from '../soroban/soroban.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
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

@Controller()
export class QueueProcessor {
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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueProcessor.name);
  }

  private setCorrelationId(payload: BasePayload): void {
    if (payload.correlationId) {
      this.logger.assign({ correlationId: payload.correlationId });
    }
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
        { event: pattern, error: err.message },
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

  @EventPattern('deal.publish')
  async handleDealPublish(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const data = this.unwrap<DealPublishPayload>(
      encrypted,
      'deal.publish',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);
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

      this.nackWithRetryLimit(channel, originalMsg, 'deal.publish', {
        dealId: data.dealId,
      });
      return;
    }

    // Acknowledge the message
    channel.ack(originalMsg);
  }

  @EventPattern('investment.fund')
  async handleInvestmentFund(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const data = this.unwrap<InvestmentFundPayload>(
      encrypted,
      'investment.fund',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);
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

        // 4. Transfer Trade_Tokens from escrow account to investor wallet.
        // Decrypt the escrow secret from the payload and use the typed
        // InvestmentFundPayload fields directly — the previously referenced
        // variables (escrowSecret, deal, investment) were never declared in
        // this method and would cause a ReferenceError at runtime.
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

    // In-process retries exhausted — mark investment as failed and route the
    // message to the DLQ (rather than ack-and-forget) so it's visible for
    // manual inspection/retry.
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

    channel.nack(originalMsg, false, false);
  }

  @EventPattern('deal.funded')
  async handleDealFunded(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const data = this.unwrap<DealFundedPayload>(
      encrypted,
      'deal.funded',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);
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
    } catch (e: any) {
      this.logger.error(
        { error: e.message },
        `Failed to send deal.funded notifications: ${e.message}`,
      );
    }

    channel.ack(originalMsg);
  }

  @EventPattern('email.notification')
  async handleEmailNotification(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const data = this.unwrap<any>(
      encrypted,
      'email.notification',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);
    this.logger.info(
      { type: data.type },
      `Processing email.notification of type ${data.type}`,
    );

    try {
      let emailAddress = data.email;
      if (!emailAddress && data.userId) {
        const user = await this.userRepo.findOne({
          where: { id: data.userId },
        });
        if (user) {
          emailAddress = user.email;
        }
      }

      if (emailAddress) {
        let subject = '';
        let text = '';
        let html = '';

        if (data.type === 'kyc_verified') {
          subject = 'KYC Verification Approved';
          text = `Your KYC verification has been approved. You can now participate in investments.`;
          html = `<h3>KYC Approved</h3><p>Your KYC verification has been approved. You can now participate in investments.</p>`;
        } else if (data.type === 'deal_completed') {
          subject = `Deal Completed: ${data.dealDetails?.commodity}`;
          text = `The deal you participated in (${data.dealDetails?.commodity}) has been completed.`;
          html = `<h3>Deal Completed</h3><p>The deal you participated in (<strong>${data.dealDetails?.commodity}</strong>) has been completed.</p>`;

          if (data.recipient === 'investor') {
            text += `\nYour return: $${data.dealDetails?.returnAmount?.toFixed(2)}`;
            html += `<p>Your return: $${data.dealDetails?.returnAmount?.toFixed(2)}</p>`;
          } else if (data.recipient === 'farmer') {
            text += `\nYour payout: $${data.dealDetails?.farmerAmount?.toFixed(2)}`;
            html += `<p>Your payout: $${data.dealDetails?.farmerAmount?.toFixed(2)}</p>`;
          }
        }

        if (subject) {
          await this.notificationsService.sendEmail(
            emailAddress,
            subject,
            text,
            html,
          );
        }
      } else {
        this.logger.warn(
          { userId: data.userId },
          'No email address found for user notification',
        );
      }
    } catch (e: any) {
      this.logger.error(
        { error: e.message },
        `Failed to send email.notification: ${e.message}`,
      );
    }

    channel.ack(originalMsg);
  }

  @EventPattern('deal.cleanup')
  async handleDealCleanup(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const data = this.unwrap<DealCleanupPayload>(
      encrypted,
      'deal.cleanup',
      channel,
      originalMsg,
    );
    if (!data) return;

    this.setCorrelationId(data);
    this.logger.info(
      { dealId: data.tradeDealId },
      `Processing deal.cleanup for deal ${data.tradeDealId}`,
    );

    try {
      const deal = await this.tradeDealsService.findOne(data.tradeDealId);
      if (!deal) {
        this.logger.warn(`Deal ${data.tradeDealId} not found for cleanup`);
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
    } catch (error) {
      this.logger.error(
        { dealId: data.tradeDealId, error: error.message },
        `Deal cleanup failed for deal ${data.tradeDealId}: ${error.message}`,
      );
      // We still ack the message, it's a best-effort cleanup
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
