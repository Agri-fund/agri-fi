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

const MAX_RETRIES = 3;

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

  @EventPattern('deal.publish')
  async handleDealPublish(
    @Payload() data: DealPublishPayload,
    @Ctx() context: RmqContext,
  ) {
    this.setCorrelationId(data);
    this.logger.info(
      { dealId: data.dealId },
      `Processing deal.publish for deal ${data.dealId}`,
    );

    try {
      // Call StellarService.issueTradeToken
      const escrowSecretKey = this.stellarService.decryptSecret(
        data.encryptedEscrowSecret,
      );
      const result = await this.stellarService.issueTradeToken(
        data.tokenSymbol,
        data.escrowPublicKey,
        escrowSecretKey,
        data.tokenCount,
      );

      // Encrypt the issuer secret
      const encryptedIssuerSecret = this.stellarService.encryptSecret(
        result.issuerSecret,
      );
      if (encryptedIssuerSecret === result.issuerSecret) {
        throw new Error('Issuer secret encryption failed');
      }

      // Update deal with issuer keys and status to open
      await this.tradeDealRepo.update(data.dealId, {
        status: 'open',
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
      await this.tradeDealRepo.update(data.dealId, { status: 'failed' });
    }

    // Acknowledge the message
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    channel.ack(originalMsg);
  }

  @EventPattern('investment.fund')
  async handleInvestmentFund(
    @Payload() data: InvestmentFundPayload,
    @Ctx() context: RmqContext,
  ) {
    this.setCorrelationId(data);
    this.logger.info(
      { investmentId: data.investmentId },
      `Processing investment.fund for investment ${data.investmentId}`,
    );

    let attempt = 0;
    let lastError: Error | null = null;
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    while (attempt < MAX_RETRIES) {
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
        const escrowSecret = this.stellarService.decryptSecret(
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
            maxRetries: MAX_RETRIES,
            error: error.message,
          },
          `investment.fund attempt ${attempt}/${MAX_RETRIES} failed for ${data.investmentId}: ${error.message}`,
        );

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * attempt)); // exponential backoff
        }
      }
    }

    // All retries exhausted — mark investment as failed
    this.logger.error(
      {
        investmentId: data.investmentId,
        maxRetries: MAX_RETRIES,
        error: lastError?.message,
      },
      `investment.fund permanently failed for ${data.investmentId} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
    await this.investmentRepo.update(data.investmentId, {
      status: 'failed' as any,
    });

    channel.ack(originalMsg);
  }

  @EventPattern('deal.funded')
  async handleDealFunded(
    @Payload() data: DealFundedPayload,
    @Ctx() context: RmqContext,
  ) {
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

    const channel = context.getChannelRef();
    channel.ack(context.getMessage());
  }

  @EventPattern('email.notification')
  async handleEmailNotification(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
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

    const channel = context.getChannelRef();
    channel.ack(context.getMessage());
  }

  @EventPattern('deal.cleanup')
  async handleDealCleanup(
    @Payload() data: DealCleanupPayload,
    @Ctx() context: RmqContext,
  ) {
    this.setCorrelationId(data);
    this.logger.info(
      { dealId: data.tradeDealId },
      `Processing deal.cleanup for deal ${data.tradeDealId}`,
    );

    try {
      const deal = await this.tradeDealsService.findOne(data.tradeDealId);
      if (!deal) {
        this.logger.warn(`Deal ${data.tradeDealId} not found for cleanup`);
        const channel = context.getChannelRef();
        channel.ack(context.getMessage());
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
          const escrowSecret = this.stellarService.decryptSecret(
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
          const issuerSecret = this.stellarService.decryptSecret(
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

    const channel = context.getChannelRef();
    channel.ack(context.getMessage());
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

    const deadlineTs = Math.floor(
      new Date(deal.deliveryDate).getTime() / 1000,
    );
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
