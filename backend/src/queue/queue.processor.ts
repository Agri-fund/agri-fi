import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { Investment } from '../investments/entities/investment.entity';
import { 
  DealPublishPayload, 
  InvestmentFundPayload, 
  BasePayload 
} from './queue.service';

const MAX_RETRIES = 3;

@Controller()
export class QueueProcessor {
  constructor(
    private readonly stellarService: StellarService,
    private readonly tradeDealsService: TradeDealsService,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
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
    this.logger.info({ dealId: data.dealId }, `Processing deal.publish for deal ${data.dealId}`);

    try {
      // Call StellarService.issueTradeToken
      const result = await this.stellarService.issueTradeToken(
        data.tokenSymbol,
        data.escrowPublicKey,
        data.escrowSecretKey,
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

        // Transfer Trade_Tokens from escrow to investor
        const escrowSecret = this.stellarService.decryptSecret(
          data.encryptedEscrowSecret,
        );
        await (this.stellarService as any).transferTokensToInvestor(
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
            error: error.message 
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
        error: lastError?.message 
      },
      `investment.fund permanently failed for ${data.investmentId} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
    await this.investmentRepo.update(data.investmentId, {
      status: 'failed' as any,
    });

    const channel = context.getChannelRef();
    channel.ack(context.getMessage());
  }
}
