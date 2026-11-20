import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from './queue.service';
import { StellarClawbackPayload } from './queue.service';
import { decryptPayload } from './queue.crypto';
import { IdempotencyService } from './idempotency.service';
import {
  DEFAULT_QUEUE_MAX_RETRIES,
  getDeliveryAttempt,
} from './retry-policy';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';

const PATTERN = 'stellar.clawback';

@Controller()
export class StellarClawbackConsumer {
  constructor(
    private readonly stellarService: StellarService,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly queueService: QueueService,
    private readonly logger: PinoLogger,
    private readonly idempotency: IdempotencyService,
  ) {
    (this.logger as any).setContext(StellarClawbackConsumer.name);
  }

  @EventPattern(PATTERN)
  handleStellarClawback(
    @Payload() encrypted: string,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const message = context.getMessage();

    this.process(encrypted, channel, message).catch((error: any) => {
      this.logger.error(
        { error: error?.message },
        'Unexpected stellar.clawback handler error',
      );
      channel.nack(message, false, false);
    });
  }

  private async process(
    encrypted: string,
    channel: any,
    message: any,
  ): Promise<void> {
    let data: StellarClawbackPayload;
    try {
      data = decryptPayload<StellarClawbackPayload>(encrypted, PATTERN);
    } catch (error: any) {
      this.logger.error(
        { error: error?.message },
        'stellar.clawback decryption failed — routing to DLQ',
      );
      channel.nack(message, false, false);
      return;
    }

    if (data.correlationId) {
      this.logger.assign({ correlationId: data.correlationId });
    }

    const idemKey = IdempotencyService.buildKey(PATTERN, data.investmentId);
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.info(
        { investmentId: data.investmentId, status: lease.status },
        'stellar.clawback duplicate — acking without reprocessing',
      );
      channel.ack(message);
      return;
    }

    const investment = await this.investmentRepo.findOne({
      where: { id: data.investmentId },
      relations: ['tradeDeal', 'investor'],
    });
    if (!investment) {
      this.logger.warn(
        { investmentId: data.investmentId },
        'stellar.clawback skipped — investment not found',
      );
      await this.idempotency.markDone(idemKey);
      channel.ack(message);
      return;
    }

    if (
      investment.status !== InvestmentStatus.PENDING &&
      investment.status !== InvestmentStatus.REFUNDED
    ) {
      this.logger.info(
        { investmentId: data.investmentId, status: investment.status },
        'stellar.clawback skipped — investment is no longer pending/refunded',
      );
      await this.idempotency.markDone(idemKey);
      channel.ack(message);
      return;
    }

    try {
      await this.clawback(investment);

      await this.investmentRepo.update(data.investmentId, {
        status: InvestmentStatus.REFUNDED,
      });
      await this.idempotency.markDone(idemKey);
      this.logger.info(
        { investmentId: data.investmentId },
        'stellar.clawback completed — investment refunded on-chain',
      );
      channel.ack(message);
    } catch (error: any) {
      const attempt = getDeliveryAttempt(message);
      await this.idempotency.releaseLease(idemKey);

      if (attempt < DEFAULT_QUEUE_MAX_RETRIES) {
        this.logger.warn(
          { investmentId: data.investmentId, attempt, error: error?.message },
          'stellar.clawback failed — requeueing',
        );
        channel.nack(message, false, true);
        return;
      }

      await this.investmentRepo.update(data.investmentId, {
        status: InvestmentStatus.PENDING,
      });
      try {
        await this.queueService.emit('admin.alert', {
          type: 'stellar_clawback_failed',
          investmentId: data.investmentId,
          tradeDealId: data.tradeDealId,
          error: error?.message,
        });
      } catch (alertError: any) {
        this.logger.error(
          { error: alertError?.message },
          'Failed to emit stellar_clawback_failed admin alert',
        );
      }
      this.logger.error(
        { investmentId: data.investmentId, error: error?.message },
        'stellar.clawback exhausted retries — investment returned to PENDING',
      );
      channel.nack(message, false, false);
    }
  }

  private async clawback(investment: Investment): Promise<void> {
    const deal = investment.tradeDeal;
    if (!deal?.issuerPublicKey || !deal.issuerSecretKey || !deal.tokenSymbol) {
      throw new Error('Trade deal is missing Stellar issuer configuration');
    }

    const walletAddress = investment.investor?.walletAddress;
    if (!walletAddress) {
      throw new Error('Investment has no investor wallet address for clawback');
    }

    const issuerSecret = await this.stellarService.decryptSecret(
      deal.issuerSecretKey,
    );
    await this.stellarService.clawbackTokens(
      deal.tokenSymbol,
      deal.issuerPublicKey,
      issuerSecret,
      [
        {
          walletAddress,
          tokenAmount: Number(investment.tokenAmount),
        },
      ],
    );
  }
}
