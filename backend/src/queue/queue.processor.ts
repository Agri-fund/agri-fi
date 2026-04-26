import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DealPublishPayload,
  InvestmentFundPayload,
  DealFundedPayload,
  BasePayload,
} from './queue.service';

const MAX_RETRIES = 3;

@Controller()
export class QueueProcessor {
  constructor(
    private readonly stellarService: StellarService,
    private readonly tradeDealsService: TradeDealsService,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
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

      // Update deal status to open and store stellar_asset_tx_id
      await this.tradeDealsService.updateDealStatus(
        data.dealId,
        'open',
        result.txId,
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
      await this.tradeDealsService.updateDealStatus(data.dealId, 'failed');
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

        const channel = context.getChannelRef();
        channel.ack(context.getMessage());
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

    channel.ack(context.getMessage());
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
}
