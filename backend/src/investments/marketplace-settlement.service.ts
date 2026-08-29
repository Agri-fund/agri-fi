import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
  SecondaryTrade,
  SecondaryTradeStatus,
} from './entities/secondary-trade.entity';
import { User } from '../auth/entities/user.entity';
import { SorobanService } from '../soroban/soroban.service';
import { QueueService } from '../queue/queue.service';

export interface CreateSecondaryTradeDto {
  sellerId: string;
  buyerId: string;
  tokenCode: string;
  tokenAmount: number;
  pricePerToken: number;
}

export interface SecondaryTradeResult {
  trade: SecondaryTrade;
  txHash: string;
}

@Injectable()
export class MarketplaceSettlementService {
  private readonly settlementContractId: string;
  private readonly platformFeeBps: number;

  constructor(
    @InjectRepository(SecondaryTrade)
    private readonly tradeRepo: Repository<SecondaryTrade>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sorobanService: SorobanService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MarketplaceSettlementService.name);
    this.settlementContractId = config.get<string>(
      'MARKETPLACE_SETTLEMENT_CONTRACT',
      '',
    );
    this.platformFeeBps = config.get<number>(
      'MARKETPLACE_PLATFORM_FEE_BPS',
      200,
    );
  }

  /**
   * Creates a new secondary trade and initiates on-chain settlement.
   */
  async createSecondaryTrade(
    dto: CreateSecondaryTradeDto,
  ): Promise<SecondaryTradeResult> {
    const { sellerId, buyerId, tokenCode, tokenAmount, pricePerToken } = dto;

    // Validate seller and buyer exist
    const [seller, buyer] = await Promise.all([
      this.userRepo.findOne({ where: { id: sellerId } }),
      this.userRepo.findOne({ where: { id: buyerId } }),
    ]);

    if (!seller) throw new NotFoundException('Seller not found');
    if (!buyer) throw new NotFoundException('Buyer not found');
    if (!seller.walletAddress)
      throw new UnprocessableEntityException('Seller has no linked wallet');
    if (!buyer.walletAddress)
      throw new UnprocessableEntityException('Buyer has no linked wallet');
    if (sellerId === buyerId)
      throw new BadRequestException('Seller and buyer cannot be the same user');

    const totalAmountUsd = tokenAmount * pricePerToken;
    const platformFeeUsd = (totalAmountUsd * this.platformFeeBps) / 10000;
    const netAmountUsd = totalAmountUsd - platformFeeUsd;

    // Generate unique order ID
    const orderId = `order-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Create pending trade record
    const trade = this.tradeRepo.create({
      orderId,
      sellerId,
      buyerId,
      tokenCode,
      tokenAmount,
      pricePerToken,
      totalAmountUsd,
      platformFeeUsd,
      netAmountUsd,
      status: SecondaryTradeStatus.PENDING,
    });

    await this.tradeRepo.save(trade);

    // Invoke Soroban contract for settlement
    try {
      const txHash = await this.sorobanService.invokeMarketplaceSettlement(
        this.settlementContractId,
        orderId,
        buyer.walletAddress,
        seller.walletAddress,
        Math.floor(totalAmountUsd * 10_000_000), // Convert to USDC stroops
      );

      // Update trade with tx hash
      trade.txHash = txHash;
      trade.status = SecondaryTradeStatus.SETTLED;
      trade.settledAt = new Date();
      await this.tradeRepo.save(trade);

      // Notify parties
      this.notifyParties(trade).catch((err) => {
        this.logger.error(
          { err, tradeId: trade.id },
          'Failed to notify trade parties',
        );
      });

      this.logger.info(
        { orderId, txHash, sellerId, buyerId, totalAmountUsd },
        'Secondary trade settled successfully',
      );

      return { trade, txHash };
    } catch (error) {
      // If contract call fails, keep order open (status remains pending)
      this.logger.error(
        { err: error, orderId, sellerId, buyerId },
        'Marketplace settlement failed - order remains open',
      );

      throw new UnprocessableEntityException({
        code: 'SETTLEMENT_FAILED',
        message:
          'On-chain settlement failed. The trade order remains open for retry.',
        orderId,
      });
    }
  }

  /**
   * Gets a secondary trade by ID.
   */
  async getSecondaryTrade(id: string): Promise<SecondaryTrade | null> {
    return this.tradeRepo.findOne({
      where: { id },
      relations: ['seller', 'buyer'],
    });
  }

  /**
   * Gets secondary trades for a user (as seller or buyer).
   */
  async getSecondaryTradesByUser(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<{ trades: SecondaryTrade[]; total: number }> {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const [trades, total] = await this.tradeRepo.findAndCount({
      where: [{ sellerId: userId }, { buyerId: userId }],
      relations: ['seller', 'buyer'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { trades, total };
  }

  /**
   * Gets a secondary trade by Soroban order ID.
   */
  async getSecondaryTradeByOrderId(
    orderId: string,
  ): Promise<SecondaryTrade | null> {
    return this.tradeRepo.findOne({
      where: { orderId },
      relations: ['seller', 'buyer'],
    });
  }

  /**
   * Notify seller and buyer of trade completion.
   */
  private async notifyParties(trade: SecondaryTrade): Promise<void> {
    // Mark notifications as sent
    trade.sellerNotified = true;
    trade.buyerNotified = true;
    await this.tradeRepo.save(trade);

    // Emit events for WebSocket/email notifications
    await this.queueService.emit('secondary_trade.settled', {
      tradeId: trade.id,
      sellerId: trade.sellerId,
      buyerId: trade.buyerId,
      tokenCode: trade.tokenCode,
      tokenAmount: trade.tokenAmount,
      totalAmountUsd: trade.totalAmountUsd,
      txHash: trade.txHash,
    });
  }

  // ── Order Book & Matching Engine (#812) ───────────────────────────────────

  async createSellOrder(dto: {
    sellerId: string;
    investmentId: string;
    dealId: string;
    askPrice: number;
    quantity: number;
    expiry?: Date;
  }) {
    const sellRepo = this.dataSource.getRepository('SellOrder');
    const order = sellRepo.create({
      sellerId: dto.sellerId,
      investmentId: dto.investmentId,
      dealId: dto.dealId,
      askPrice: dto.askPrice,
      quantity: dto.quantity,
      filledQuantity: 0,
      expiry: dto.expiry || null,
      status: 'open',
    });
    const saved = await sellRepo.save(order);
    this.matchOrders(dto.dealId).catch((err) =>
      this.logger.error({ err, dealId: dto.dealId }, 'Order matching error'),
    );
    return saved;
  }

  async createBuyOrder(dto: {
    buyerId: string;
    dealId: string;
    bidPrice: number;
    quantity: number;
    expiry?: Date;
  }) {
    const buyRepo = this.dataSource.getRepository('BuyOrder');
    const order = buyRepo.create({
      buyerId: dto.buyerId,
      dealId: dto.dealId,
      bidPrice: dto.bidPrice,
      quantity: dto.quantity,
      filledQuantity: 0,
      expiry: dto.expiry || null,
      status: 'open',
    });
    const saved = await buyRepo.save(order);
    this.matchOrders(dto.dealId).catch((err) =>
      this.logger.error({ err, dealId: dto.dealId }, 'Order matching error'),
    );
    return saved;
  }

  async getOrderBook(dealId: string) {
    const sellRepo = this.dataSource.getRepository('SellOrder');
    const buyRepo = this.dataSource.getRepository('BuyOrder');

    const [asks, bids] = await Promise.all([
      sellRepo.find({
        where: { dealId, status: 'open' },
        order: { askPrice: 'ASC' },
      }),
      buyRepo.find({
        where: { dealId, status: 'open' },
        order: { bidPrice: 'DESC' },
      }),
    ]);

    return { dealId, asks, bids };
  }

  async matchOrders(dealId: string): Promise<void> {
    const sellRepo = this.dataSource.getRepository<any>('SellOrder');
    const buyRepo = this.dataSource.getRepository<any>('BuyOrder');

    const asks = await sellRepo.find({
      where: { dealId, status: 'open' },
      order: { askPrice: 'ASC', createdAt: 'ASC' },
    });

    const bids = await buyRepo.find({
      where: { dealId, status: 'open' },
      order: { bidPrice: 'DESC', createdAt: 'ASC' },
    });

    for (const ask of asks) {
      for (const bid of bids) {
        if (Number(ask.askPrice) <= Number(bid.bidPrice)) {
          const askRemaining =
            Number(ask.quantity) - Number(ask.filledQuantity);
          const bidRemaining =
            Number(bid.quantity) - Number(bid.filledQuantity);
          if (askRemaining <= 0 || bidRemaining <= 0) continue;

          const matchQty = Math.min(askRemaining, bidRemaining);
          const matchPrice = Number(ask.askPrice);

          try {
            await this.createSecondaryTrade({
              sellerId: ask.sellerId,
              buyerId: bid.buyerId,
              tokenCode: 'FARM_SHARE',
              tokenAmount: matchQty,
              pricePerToken: matchPrice,
            });

            ask.filledQuantity = Number(ask.filledQuantity) + matchQty;
            bid.filledQuantity = Number(bid.filledQuantity) + matchQty;

            if (ask.filledQuantity >= ask.quantity) ask.status = 'filled';
            else ask.status = 'partially_filled';

            if (bid.filledQuantity >= bid.quantity) bid.status = 'filled';
            else bid.status = 'partially_filled';

            await sellRepo.save(ask);
            await buyRepo.save(bid);
          } catch (err) {
            this.logger.error({ err }, 'Order match execution failed');
          }
        }
      }
    }
  }
}
