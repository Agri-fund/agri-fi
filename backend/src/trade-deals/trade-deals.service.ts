import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal, DealStatus } from './entities/trade-deal.entity';
import { Document } from './entities/document.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class TradeDealsService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
  ) {}

  async publishDeal(dealId: string, userId: string): Promise<TradeDeal> {
    // Find the deal with relations
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['documents'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }

    // Only the trader who owns the deal can publish it
    if (deal.traderId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_DEAL_OWNER',
        message: 'Only the trader who owns the deal can publish it',
      });
    }

    // Deal must currently have status = 'draft'
    if (deal.status !== 'draft') {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Deal must have status "draft" to be published',
      });
    }

    // At least one document must be linked to the deal
    if (!deal.documents || deal.documents.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_DOCUMENTS',
        message: 'At least one document must be linked to the deal before publishing',
      });
    }

    // Ensure escrow account exists
    if (!deal.escrowPublicKey || !deal.escrowSecretKey) {
      const escrow = await this.stellarService.createEscrowAccount(deal.id);
      deal.escrowPublicKey = escrow.publicKey;
      deal.escrowSecretKey = escrow.secretKey;
      await this.tradeDealRepo.save(deal);
    }

    // Enqueue the deal.publish job
    await this.queueService.emit('deal.publish', {
      dealId: deal.id,
      tokenSymbol: deal.tokenSymbol,
      escrowPublicKey: deal.escrowPublicKey,
      escrowSecretKey: deal.escrowSecretKey,
      tokenCount: deal.tokenCount,
    });

    return deal;
  }

  async findOne(id: string): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id },
      relations: ['farmer', 'trader', 'documents'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }

    return deal;
  }

  async updateDealStatus(
    dealId: string,
    status: DealStatus,
    stellarAssetTxId?: string,
  ): Promise<void> {
    await this.tradeDealRepo.update(dealId, {
      status,
      ...(stellarAssetTxId && { stellarAssetTxId }),
    });
  }
}
