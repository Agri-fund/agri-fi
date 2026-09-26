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
import {
  SecondaryOrder,
  SecondaryOrderSide,
  SecondaryOrderStatus,
  SecondaryOrderType,
  StopLossDirection,
} from './entities/secondary-order.entity';
import {
  CancelSecondaryOrderDto,
  CreateSecondaryOrderDto,
} from './dto/secondary-order.dto';
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

/** One resting order that a taker consumed, plus the resulting on-chain trade. */
export interface OrderFill {
  takerOrderId: string;
  makerOrderId: string;
  tokenCode: string;
  amount: number;
  pricePerToken: number;
  trade: SecondaryTrade;
  txHash: string;
}

export interface MatchOrderResult {
  order: SecondaryOrder;
  /** True when a stop-loss order armed because the market price crossed. */
  triggered: boolean;
  /** True when an FOK order was killed for want of a full fill. */
  killed: boolean;
  /** True when the order ended the sweep fully filled. */
  filled: boolean;
  fills: OrderFill[];
  /** Best opposing price seen, or null when the book was empty. */
  bestOpposingPrice: number | null;
}

export interface OrderBookLevel {
  pricePerToken: number;
  amount: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  tokenCode: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice: number | null;
}

/** Precision for token amounts; matches the DECIMAL(36,7) columns. */
const AMOUNT_SCALE = 7;
const QTY_EPSILON = 1e-7;

@Injectable()
export class MarketplaceSettlementService {
  private readonly settlementContractId: string;
  private readonly platformFeeBps: number;

  constructor(
    @InjectRepository(SecondaryTrade)
    private readonly tradeRepo: Repository<SecondaryTrade>,
    @InjectRepository(SecondaryOrder)
    private readonly orderRepo: Repository<SecondaryOrder>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sorobanService: SorobanService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(MarketplaceSettlementService.name);
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

    const { totalAmountUsd, platformFeeUsd, netAmountUsd } = this.computeFees(
      tokenAmount,
      pricePerToken,
    );

    // Generate unique order ID
    const orderId = this.generateId('order');

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
      const txHash = await this.settleTrade(trade, buyer, seller);

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
   * Invokes the marketplace_settlement contract for a pending trade and flips
   * the record to `settled`. Throws on contract failure so callers decide
   * whether that is fatal.
   */
  private async settleTrade(
    trade: SecondaryTrade,
    buyer: User,
    seller: User,
  ): Promise<string> {
    const txHash = await this.sorobanService.invokeMarketplaceSettlement(
      this.settlementContractId,
      trade.orderId,
      buyer.walletAddress,
      seller.walletAddress,
      Math.floor(toNumber(trade.totalAmountUsd) * 10_000_000), // Convert to USDC stroops
    );

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

    return txHash;
  }

  private computeFees(
    tokenAmount: number,
    pricePerToken: number,
  ): { totalAmountUsd: number; platformFeeUsd: number; netAmountUsd: number } {
    const totalAmountUsd = roundAmount(tokenAmount * pricePerToken);
    const platformFeeUsd = roundAmount(
      (totalAmountUsd * this.platformFeeBps) / 10000,
    );
    const netAmountUsd = roundAmount(totalAmountUsd - platformFeeUsd);

    return { totalAmountUsd, platformFeeUsd, netAmountUsd };
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
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

  // ─── Secondary Orders ───────────────────────────────────────────────────

  /**
   * Places an order on the book.
   *
   * `limit` rests and may fill partially. `fok` must be fillable in full at
   * submission time or it is cancelled immediately. `stop_loss` is stored
   * dormant and only becomes matchable once the market price crosses its
   * trigger in the configured direction.
   */
  async createOrder(
    userId: string,
    dto: CreateSecondaryOrderDto,
  ): Promise<MatchOrderResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.walletAddress)
      throw new UnprocessableEntityException('User has no linked wallet');

    if (dto.tokenAmount <= 0)
      throw new BadRequestException('tokenAmount must be greater than zero');
    if (dto.pricePerToken <= 0)
      throw new BadRequestException('pricePerToken must be greater than zero');

    const type = dto.type ?? SecondaryOrderType.LIMIT;
    const side = dto.side;

    if (type === SecondaryOrderType.STOP_LOSS) {
      if (dto.triggerPrice === undefined || dto.triggerPrice === null)
        throw new BadRequestException(
          'triggerPrice is required for stop_loss orders',
        );
      if (dto.triggerPrice <= 0)
        throw new BadRequestException('triggerPrice must be greater than zero');
    }

    // A stop that would arm immediately is rejected: the market is already
    // past the trigger, so the order is stale by the time it reaches the book.
    const lastPrice = await this.getLastPrice(dto.tokenCode);
    if (
      type === SecondaryOrderType.STOP_LOSS &&
      lastPrice !== null &&
      this.isTriggerSatisfied(
        resolveStopDirection(dto.stopDirection, side),
        lastPrice,
        dto.triggerPrice!,
      )
    ) {
      throw new UnprocessableEntityException({
        code: 'STOP_ALREADY_CROSSED',
        message:
          `Market price ${lastPrice} has already crossed triggerPrice ` +
          `${dto.triggerPrice}; the stop would arm on arrival.`,
        tokenCode: dto.tokenCode,
        lastPrice,
      });
    }

    const order = this.orderRepo.create({
      orderId: this.generateId('sord'),
      userId,
      side,
      type,
      tokenCode: dto.tokenCode,
      tokenAmount: roundAmount(dto.tokenAmount),
      filledAmount: 0,
      pricePerToken: roundAmount(dto.pricePerToken),
      triggerPrice:
        type === SecondaryOrderType.STOP_LOSS
          ? roundAmount(dto.triggerPrice!)
          : null,
      stopDirection:
        type === SecondaryOrderType.STOP_LOSS
          ? resolveStopDirection(dto.stopDirection, side)
          : null,
      status: SecondaryOrderStatus.OPEN,
      expiresAt: dto.expiresAt ?? null,
      triggeredAt: null,
      filledAt: null,
      cancelledAt: null,
      cancelReason: null,
    });

    await this.orderRepo.save(order);

    this.logger.info(
      {
        orderId: order.orderId,
        userId,
        side,
        type,
        tokenCode: dto.tokenCode,
        tokenAmount: order.tokenAmount,
        pricePerToken: order.pricePerToken,
        triggerPrice: order.triggerPrice,
        stopDirection: order.stopDirection,
      },
      'Secondary order placed',
    );

    return this.matchOrder(order.id);
  }

  /**
   * Cancels a resting order. Only the maker may cancel, and only while the
   * order is still on the book.
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    dto: CancelSecondaryOrderDto = {},
  ): Promise<SecondaryOrder> {
    const order = await this.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId)
      throw new BadRequestException('Only the maker can cancel this order');
    if (!isResting(order))
      throw new BadRequestException(
        `Order is ${order.status} and can no longer be cancelled`,
      );

    order.status = SecondaryOrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = dto.reason ?? 'user_requested';
    const saved = await this.orderRepo.save(order);

    await this.queueService.emit('secondary_order.cancelled', {
      orderId: saved.orderId,
      userId,
      tokenCode: saved.tokenCode,
      reason: saved.cancelReason,
    });

    return saved;
  }

  async getOrder(orderId: string): Promise<SecondaryOrder | null> {
    return this.orderRepo.findOne({ where: { orderId } });
  }

  async getOrderById(id: string): Promise<SecondaryOrder | null> {
    return this.orderRepo.findOne({ where: { id }, relations: ['user'] });
  }

  async getOrdersByUser(
    userId: string,
    options: {
      status?: SecondaryOrderStatus;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ orders: SecondaryOrder[]; total: number }> {
    const { status, page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const where = status ? { userId, status } : { userId };

    const [orders, total] = await this.orderRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { orders, total };
  }

  /**
   * Aggregated depth for a token. Bids descend, asks ascend, and both exclude
   * dormant stop orders since they are not matchable yet.
   */
  async getOrderBook(
    tokenCode: string,
    depth = 20,
  ): Promise<OrderBookSnapshot> {
    const [bids, asks] = await Promise.all([
      this.aggregateLevels(tokenCode, SecondaryOrderSide.BUY, depth),
      this.aggregateLevels(tokenCode, SecondaryOrderSide.SELL, depth),
    ]);

    return {
      tokenCode,
      bids,
      asks,
      lastPrice: await this.getLastPrice(tokenCode),
    };
  }

  private async aggregateLevels(
    tokenCode: string,
    side: SecondaryOrderSide,
    depth: number,
  ): Promise<OrderBookLevel[]> {
    const orders = await this.findRestingOrders(tokenCode, side, depth * 4);

    const levels = new Map<number, OrderBookLevel>();
    for (const order of orders) {
      const price = toNumber(order.pricePerToken);
      const existing = levels.get(price);
      const amount = toNumber(order.tokenAmount) - toNumber(order.filledAmount);
      if (amount <= QTY_EPSILON) continue;

      if (existing) {
        existing.amount = roundAmount(existing.amount + amount);
        existing.orderCount += 1;
      } else {
        levels.set(price, { pricePerToken: price, amount, orderCount: 1 });
      }
    }

    return Array.from(levels.values()).slice(0, depth);
  }

  /**
   * Distinct token codes with at least one order the matching sweep should
   * look at: resting orders, or stop orders still waiting to arm.
   */
  async getActiveTokenCodes(): Promise<string[]> {
    const resting = await this.orderRepo
      .createQueryBuilder('o')
      .select('DISTINCT o.token_code', 'tokenCode')
      .where('o.status IN (:...statuses)', {
        statuses: RESTING_STATUSES,
      })
      .getRawMany<{ tokenCode: string }>();

    const pendingStops = await this.orderRepo
      .createQueryBuilder('o')
      .select('DISTINCT o.token_code', 'tokenCode')
      .where('o.type = :type', { type: SecondaryOrderType.STOP_LOSS })
      .andWhere('o.status IN (:...statuses)', {
        statuses: [SecondaryOrderStatus.OPEN],
      })
      .andWhere('o.triggered_at IS NULL')
      .getRawMany<{ tokenCode: string }>();

    return Array.from(
      new Set([...resting, ...pendingStops].map((r) => r.tokenCode)),
    );
  }

  /**
   * Arms every untriggered stop order for a token whose trigger the current
   * market price satisfies. Called by the scheduled sweep before matching.
   */
  async processStopLossTriggers(tokenCode: string): Promise<SecondaryOrder[]> {
    const marketPrice = await this.getLastPrice(tokenCode);
    if (marketPrice === null) return [];

    const dormant = await this.orderRepo.find({
      where: {
        tokenCode,
        type: SecondaryOrderType.STOP_LOSS,
        status: SecondaryOrderStatus.OPEN,
      },
    });

    const armed: SecondaryOrder[] = [];
    for (const order of dormant) {
      const triggerPrice = toNumber(order.triggerPrice);
      if (triggerPrice <= 0) continue;
      if (!order.stopDirection) continue;
      if (
        !this.isTriggerSatisfied(order.stopDirection, marketPrice, triggerPrice)
      )
        continue;

      order.status = SecondaryOrderStatus.TRIGGERED;
      order.triggeredAt = new Date();
      const saved = await this.orderRepo.save(order);

      this.logger.info(
        {
          orderId: saved.orderId,
          tokenCode,
          marketPrice,
          triggerPrice,
          stopDirection: saved.stopDirection,
        },
        'Stop-loss order armed by price crossing',
      );

      await this.queueService.emit('secondary_order.triggered', {
        orderId: saved.orderId,
        userId: saved.userId,
        tokenCode,
        marketPrice,
        triggerPrice,
        side: saved.side,
        type: saved.type,
      });

      armed.push(saved);
    }

    return armed;
  }

  /**
   * Runs one matching pass for a single order.
   *
   * Stop-loss orders are held back until their trigger fires. FOK orders check
   * the whole available size up front and are killed rather than partially
   * filled. Limit orders sweep the opposing book in price-time priority.
   */
  async matchOrder(orderId: string): Promise<MatchOrderResult> {
    let order = await this.getOrder(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const empty: MatchOrderResult = {
      order,
      triggered: false,
      killed: false,
      filled: false,
      fills: [],
      bestOpposingPrice: null,
    };

    if (isTerminal(order)) return empty;

    // Expiry wins over everything else, including an armed stop.
    if (order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now()) {
      order.status = SecondaryOrderStatus.EXPIRED;
      order.cancelledAt = new Date();
      order.cancelReason = 'expired';
      empty.order = await this.orderRepo.save(order);
      return empty;
    }

    // Stop-loss semantics: the order only becomes matchable once the market
    // price has crossed the trigger in the order's direction.
    if (order.type === SecondaryOrderType.STOP_LOSS && !order.triggeredAt) {
      const marketPrice = await this.getLastPrice(order.tokenCode);
      if (
        marketPrice === null ||
        !order.stopDirection ||
        !this.isTriggerSatisfied(
          order.stopDirection,
          marketPrice,
          toNumber(order.triggerPrice),
        )
      ) {
        return empty;
      }

      order.status = SecondaryOrderStatus.TRIGGERED;
      order.triggeredAt = new Date();
      order = await this.orderRepo.save(order);

      this.logger.info(
        {
          orderId: order.orderId,
          tokenCode: order.tokenCode,
          marketPrice,
          triggerPrice: toNumber(order.triggerPrice),
          stopDirection: order.stopDirection,
        },
        'Stop-loss order armed by price crossing',
      );

      await this.queueService.emit('secondary_order.triggered', {
        orderId: order.orderId,
        userId: order.userId,
        tokenCode: order.tokenCode,
        marketPrice,
        triggerPrice: toNumber(order.triggerPrice),
        side: order.side,
        type: order.type,
      });
    }

    const makers = await this.findCrossingMakers(order);
    const bestOpposingPrice =
      makers.length > 0 ? toNumber(makers[0].pricePerToken) : null;
    const remaining = () =>
      roundAmount(toNumber(order.tokenAmount) - toNumber(order.filledAmount));

    // Fill-or-kill: probe the book first. Any shortfall kills the whole order
    // rather than consuming liquidity, so nothing partial is left behind.
    if (order.type === SecondaryOrderType.FOK) {
      const available = makers
        .filter((maker) => maker.userId !== order.userId)
        .reduce((sum, maker) => {
          const open =
            toNumber(maker.tokenAmount) - toNumber(maker.filledAmount);
          return sum + Math.max(0, open);
        }, 0);

      if (available + QTY_EPSILON < remaining()) {
        order.status = SecondaryOrderStatus.CANCELLED;
        order.cancelledAt = new Date();
        order.cancelReason = 'fok_no_liquidity';

        this.logger.info(
          {
            orderId: order.orderId,
            tokenCode: order.tokenCode,
            requested: remaining(),
            available: roundAmount(available),
          },
          'Fill-or-kill order killed - full size unavailable',
        );

        await this.queueService.emit('secondary_order.cancelled', {
          orderId: order.orderId,
          userId: order.userId,
          tokenCode: order.tokenCode,
          reason: order.cancelReason,
        });

        return {
          order: await this.orderRepo.save(order),
          triggered: order.triggeredAt !== null,
          killed: true,
          filled: false,
          fills: [],
          bestOpposingPrice,
        };
      }
    }

    const fills: OrderFill[] = [];

    for (const maker of makers) {
      if (remaining() <= QTY_EPSILON) break;
      // Self-trade prevention.
      if (maker.userId === order.userId) continue;

      const makerOpen = roundAmount(
        toNumber(maker.tokenAmount) - toNumber(maker.filledAmount),
      );
      if (makerOpen <= QTY_EPSILON) continue;

      const amount = roundAmount(Math.min(remaining(), makerOpen));
      if (amount <= QTY_EPSILON) continue;

      const price = toNumber(maker.pricePerToken);
      const sellerId =
        order.side === SecondaryOrderSide.SELL ? order.userId : maker.userId;
      const buyerId =
        order.side === SecondaryOrderSide.SELL ? maker.userId : order.userId;

      try {
        const fill = await this.recordFill({
          taker: order,
          maker,
          amount,
          price,
          sellerId,
          buyerId,
        });
        fills.push(fill);
      } catch (error) {
        // A failed on-chain settlement must not consume the fill: leave the
        // remainder on the book and let the next sweep retry.
        this.logger.error(
          {
            err: error,
            takerOrderId: order.orderId,
            makerOrderId: maker.orderId,
            amount,
          },
          'Fill settlement failed - size left on the book',
        );
        break;
      }

      order.filledAmount = roundAmount(toNumber(order.filledAmount) + amount);
      if (order.filledAmount + QTY_EPSILON >= toNumber(order.tokenAmount)) {
        order.status = SecondaryOrderStatus.FILLED;
        order.filledAt = new Date();
      } else {
        order.status = SecondaryOrderStatus.PARTIALLY_FILLED;
      }
      await this.orderRepo.save(order);

      maker.filledAmount = roundAmount(toNumber(maker.filledAmount) + amount);
      if (maker.filledAmount + QTY_EPSILON >= toNumber(maker.tokenAmount)) {
        maker.status = SecondaryOrderStatus.FILLED;
        maker.filledAt = new Date();
      } else {
        maker.status = SecondaryOrderStatus.PARTIALLY_FILLED;
      }
      await this.orderRepo.save(maker);
    }

    const filled = order.status === SecondaryOrderStatus.FILLED;

    if (fills.length > 0 || filled) {
      this.logger.info(
        {
          orderId: order.orderId,
          tokenCode: order.tokenCode,
          side: order.side,
          type: order.type,
          status: order.status,
          fills: fills.length,
        },
        'Secondary order matched',
      );
    }

    return {
      order,
      triggered: order.triggeredAt !== null,
      killed: false,
      filled,
      fills,
      bestOpposingPrice,
    };
  }

  /**
   * Matching sweep for one token: arm any stop orders the market has crossed,
   * then run every resting order in time priority so a fresh taker cannot be
   * beaten to liquidity by an older one.
   */
  async matchOpenOrders(tokenCode: string): Promise<MatchOrderResult[]> {
    await this.processStopLossTriggers(tokenCode);

    const orders = await this.orderRepo.find({
      where: RESTING_STATUSES.map((status) => ({ tokenCode, status })),
      order: { createdAt: 'ASC' },
    });

    const results: MatchOrderResult[] = [];
    for (const order of orders) {
      try {
        results.push(await this.matchOrder(order.orderId));
      } catch (error) {
        this.logger.error(
          { err: error, orderId: order.orderId },
          'Order match failed, continuing sweep',
        );
      }
    }

    return results;
  }

  /**
   * Settles one fill and updates both legs. Throws if on-chain settlement
   * fails so the caller can leave the size unfilled.
   */
  private async recordFill(params: {
    taker: SecondaryOrder;
    maker: SecondaryOrder;
    amount: number;
    price: number;
    sellerId: string;
    buyerId: string;
  }): Promise<OrderFill> {
    const { taker, maker, amount, price, sellerId, buyerId } = params;

    const [seller, buyer] = await Promise.all([
      this.userRepo.findOne({ where: { id: sellerId } }),
      this.userRepo.findOne({ where: { id: buyerId } }),
    ]);

    if (!seller || !buyer) throw new NotFoundException('Fill party not found');
    if (!seller.walletAddress || !buyer.walletAddress)
      throw new UnprocessableEntityException('Fill party has no linked wallet');

    const { totalAmountUsd, platformFeeUsd, netAmountUsd } = this.computeFees(
      amount,
      price,
    );

    const trade = this.tradeRepo.create({
      orderId: this.generateId('order'),
      sellerId,
      buyerId,
      tokenCode: taker.tokenCode,
      tokenAmount: amount,
      pricePerToken: price,
      totalAmountUsd,
      platformFeeUsd,
      netAmountUsd,
      status: SecondaryTradeStatus.PENDING,
      metadata: {
        takerOrderId: taker.orderId,
        makerOrderId: maker.orderId,
        matchedAt: new Date().toISOString(),
      },
    });

    await this.tradeRepo.save(trade);

    const txHash = await this.settleTrade(trade, buyer, seller);

    return {
      takerOrderId: taker.orderId,
      makerOrderId: maker.orderId,
      tokenCode: taker.tokenCode,
      amount,
      pricePerToken: price,
      trade,
      txHash,
    };
  }

  /**
   * Resting opposing orders that cross the taker's limit, best price first and
   * then oldest first. Dormant stop orders and expired orders are excluded.
   */
  private async findCrossingMakers(
    taker: SecondaryOrder,
  ): Promise<SecondaryOrder[]> {
    const opposing = oppositeSide(taker.side);
    const isBuy = taker.side === SecondaryOrderSide.BUY;
    const takerPrice = toNumber(taker.pricePerToken);

    const qb = this.orderRepo
      .createQueryBuilder('m')
      .where('m.token_code = :tokenCode', { tokenCode: taker.tokenCode })
      .andWhere('m.side = :side', { side: opposing })
      .andWhere('m.status IN (:...statuses)', { statuses: RESTING_STATUSES })
      .andWhere('m.filled_amount < m.token_amount')
      .andWhere('(m.expires_at IS NULL OR m.expires_at > NOW())')
      .andWhere(
        isBuy ? 'm.price_per_token <= :price' : 'm.price_per_token >= :price',
        {
          price: takerPrice,
        },
      )
      // A stop order is only matchable once its trigger has fired.
      .andWhere('(m.type <> :stop OR m.triggered_at IS NOT NULL)', {
        stop: SecondaryOrderType.STOP_LOSS,
      })
      .orderBy(
        isBuy ? 'm.price_per_token ASC' : 'm.price_per_token DESC',
        'ASC',
      )
      .addOrderBy('m.created_at', 'ASC');

    return qb.getMany();
  }

  /**
   * Resting orders for one side of the book, best price first then oldest
   * first, excluding dormant stop orders.
   */
  private async findRestingOrders(
    tokenCode: string,
    side: SecondaryOrderSide,
    take: number,
  ): Promise<SecondaryOrder[]> {
    const isBuy = side === SecondaryOrderSide.BUY;

    return this.orderRepo
      .createQueryBuilder('o')
      .where('o.token_code = :tokenCode', { tokenCode })
      .andWhere('o.side = :side', { side })
      .andWhere('o.status IN (:...statuses)', { statuses: RESTING_STATUSES })
      .andWhere('o.filled_amount < o.token_amount')
      .andWhere('(o.expires_at IS NULL OR o.expires_at > NOW())')
      .andWhere('(o.type <> :stop OR o.triggered_at IS NOT NULL)', {
        stop: SecondaryOrderType.STOP_LOSS,
      })
      .orderBy(
        isBuy ? 'o.price_per_token DESC' : 'o.price_per_token ASC',
        'ASC',
      )
      .addOrderBy('o.created_at', 'ASC')
      .take(take)
      .getMany();
  }

  /**
   * Latest settled trade price for a token, used as the market price that
   * stop triggers are evaluated against. Null on a cold market.
   */
  private async getLastPrice(tokenCode: string): Promise<number | null> {
    const trade = await this.tradeRepo.findOne({
      where: { tokenCode, status: SecondaryTradeStatus.SETTLED },
      order: { settledAt: 'DESC' },
    });

    if (!trade) return null;
    return toNumber(trade.pricePerToken);
  }

  /**
   * Cross-direction trigger test.
   *
   * `above` (buy stop) arms when the market has risen to or through the
   * trigger; `below` (sell stop) arms when it has fallen to or through it.
   * Touching the trigger counts as a crossing.
   */
  private isTriggerSatisfied(
    direction: StopLossDirection,
    marketPrice: number,
    triggerPrice: number,
  ): boolean {
    if (!Number.isFinite(marketPrice) || !Number.isFinite(triggerPrice)) {
      return false;
    }
    if (triggerPrice <= 0) return false;

    return direction === StopLossDirection.ABOVE
      ? marketPrice >= triggerPrice
      : marketPrice <= triggerPrice;
  }

  // ─── Legacy deal-scoped API (issue #812) ───────────────────────────────
  //
  // These back the shipped `POST orders/sell`, `POST orders/buy` and
  // `GET orders/orderbook/:dealId` routes, which predate the unified
  // `secondary_orders` table and were keyed by trade deal rather than token.
  // They now write to the unified table so there is a single book and a
  // single matching path. Prefer `createOrder` / `getOrderBook` for new work.

  /**
   * Resolves the token code a deal-scoped order should trade against, falling
   * back to the `UNSET` placeholder that matching skips (see migration
   * 1960000000000).
   */
  private async resolveDealTokenCode(dealId: string): Promise<string> {
    const deal = await this.dataSource.query(
      `SELECT token_symbol FROM trade_deals WHERE id = $1`,
      [dealId],
    );
    return deal?.[0]?.token_symbol || 'UNSET';
  }

  async createSellOrder(dto: {
    sellerId: string;
    investmentId: string;
    dealId: string;
    askPrice: number;
    quantity: number;
    expiry?: Date;
  }): Promise<MatchOrderResult> {
    const tokenCode = await this.resolveDealTokenCode(dto.dealId);

    const result = await this.createOrder(dto.sellerId, {
      tokenCode,
      side: SecondaryOrderSide.SELL,
      type: SecondaryOrderType.LIMIT,
      tokenAmount: dto.quantity,
      pricePerToken: dto.askPrice,
      expiresAt: dto.expiry,
    });

    result.order.dealId = dto.dealId;
    result.order.investmentId = dto.investmentId;
    await this.orderRepo.save(result.order);

    return result;
  }

  async createBuyOrder(dto: {
    buyerId: string;
    dealId: string;
    bidPrice: number;
    quantity: number;
    expiry?: Date;
  }): Promise<MatchOrderResult> {
    const tokenCode = await this.resolveDealTokenCode(dto.dealId);

    const result = await this.createOrder(dto.buyerId, {
      tokenCode,
      side: SecondaryOrderSide.BUY,
      type: SecondaryOrderType.LIMIT,
      tokenAmount: dto.quantity,
      pricePerToken: dto.bidPrice,
      expiresAt: dto.expiry,
    });

    result.order.dealId = dto.dealId;
    await this.orderRepo.save(result.order);

    return result;
  }

  /**
   * Deal-scoped order book, preserving the legacy `{ dealId, asks, bids }`
   * response shape.
   */
  async getDealOrderBook(dealId: string): Promise<{
    dealId: string;
    asks: SecondaryOrder[];
    bids: SecondaryOrder[];
  }> {
    const [asks, bids] = await Promise.all([
      this.orderRepo.find({
        where: { dealId, side: SecondaryOrderSide.SELL },
        order: { pricePerToken: 'ASC', createdAt: 'ASC' },
      }),
      this.orderRepo.find({
        where: { dealId, side: SecondaryOrderSide.BUY },
        order: { pricePerToken: 'DESC', createdAt: 'ASC' },
      }),
    ]);

    return { dealId, asks, bids };
  }

  /**
   * Runs a matching pass for every token that has live orders on a deal's
   * book. Retained for callers of the old `matchOrders(dealId)` entry point.
   */
  async matchOrders(dealId: string): Promise<void> {
    const rows = await this.orderRepo.find({
      where: { dealId },
      select: ['tokenCode'],
    });

    const tokenCodes = Array.from(new Set(rows.map((r) => r.tokenCode)));
    for (const tokenCode of tokenCodes) {
      await this.matchOpenOrders(tokenCode);
    }
  }
}

/** Statuses that still sit on the book and can be matched. */
const RESTING_STATUSES: SecondaryOrderStatus[] = [
  SecondaryOrderStatus.OPEN,
  SecondaryOrderStatus.TRIGGERED,
  SecondaryOrderStatus.PARTIALLY_FILLED,
];

function isResting(order: SecondaryOrder): boolean {
  return RESTING_STATUSES.includes(order.status);
}

function isTerminal(order: SecondaryOrder): boolean {
  return (
    order.status === SecondaryOrderStatus.FILLED ||
    order.status === SecondaryOrderStatus.CANCELLED ||
    order.status === SecondaryOrderStatus.EXPIRED
  );
}

function oppositeSide(side: SecondaryOrderSide): SecondaryOrderSide {
  return side === SecondaryOrderSide.BUY
    ? SecondaryOrderSide.SELL
    : SecondaryOrderSide.BUY;
}

/** Sells stop out on the way down, buys stop out on the way up. */
function resolveStopDirection(
  requested: StopLossDirection | undefined,
  side: SecondaryOrderSide,
): StopLossDirection {
  if (requested) return requested;
  return side === SecondaryOrderSide.SELL
    ? StopLossDirection.BELOW
    : StopLossDirection.ABOVE;
}

/** Postgres DECIMAL columns come back as strings; normalise before maths. */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value: number): number {
  return Number(value.toFixed(AMOUNT_SCALE));
}
