import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';

interface DealPublishPayload {
  dealId: string;
  tokenSymbol: string;
  escrowPublicKey: string;
  escrowSecretKey: string;
  tokenCount: number;
}

@Controller()
export class QueueProcessor {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    private readonly stellarService: StellarService,
    private readonly tradeDealsService: TradeDealsService,
  ) {}

  @EventPattern('deal.publish')
  async handleDealPublish(
    @Payload() data: DealPublishPayload,
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(`Processing deal.publish for deal ${data.dealId}`);
    
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

      this.logger.log(
        `Successfully published deal ${data.dealId} with txId ${result.txId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish deal ${data.dealId}: ${error.message}`,
        error.stack,
      );

      // On Stellar failure: mark deal status = 'failed'
      await this.tradeDealsService.updateDealStatus(data.dealId, 'failed');
    }

    // Acknowledge the message
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    channel.ack(originalMsg);
  }
}
