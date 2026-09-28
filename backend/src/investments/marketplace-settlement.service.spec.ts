import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { MarketplaceSettlementService } from './marketplace-settlement.service';
import {
  SecondaryOrder,
  SecondaryOrderSide,
  SecondaryOrderStatus,
  SecondaryOrderType,
  StopLossDirection,
} from './entities/secondary-order.entity';
import {
  SecondaryTrade,
  SecondaryTradeStatus,
} from './entities/secondary-trade.entity';
import { User } from '../auth/entities/user.entity';
import { SorobanService } from '../soroban/soroban.service';
import { QueueService } from '../queue/queue.service';

const PLATFORM_FEE_BPS = 200;

function makeOrder(overrides: Partial<SecondaryOrder> = {}): SecondaryOrder {
  return {
    id: overrides.id ?? 'o-id',
    orderId: overrides.orderId ?? 'sord-1',
    userId: overrides.userId ?? 'user-maker',
    side: overrides.side ?? SecondaryOrderSide.SELL,
    type: overrides.type ?? SecondaryOrderType.LIMIT,
    tokenCode: overrides.tokenCode ?? 'FARM001',
    tokenAmount: overrides.tokenAmount ?? 100,
    filledAmount: overrides.filledAmount ?? 0,
    pricePerToken: overrides.pricePerToken ?? 10,
    triggerPrice: overrides.triggerPrice ?? null,
    stopDirection: overrides.stopDirection ?? null,
    status: overrides.status ?? SecondaryOrderStatus.OPEN,
    expiresAt: overrides.expiresAt ?? null,
    triggeredAt: overrides.triggeredAt ?? null,
    filledAt: overrides.filledAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelReason: overrides.cancelReason ?? null,
    createdAt: overrides.createdAt ?? new Date('2024-01-15T10:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-15T10:00:00Z'),
  } as SecondaryOrder;
}

describe('MarketplaceSettlementService — secondary order matching', () => {
  let service: MarketplaceSettlementService;
  let orderRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let sorobanService: Record<string, jest.Mock>;
  let queueService: Record<string, jest.Mock>;

  /** Orders the mocked repository currently holds, by orderId. */
  let book: SecondaryOrder[];

  beforeEach(async () => {
    book = [];
    let seq = 0;

    orderRepo = {
      create: jest.fn((data: Partial<SecondaryOrder>) => ({
        ...data,
        id: data.id ?? `order-db-${++seq}`,
      })),
      save: jest.fn(async (order: SecondaryOrder) => {
        const existing = book.findIndex((o) => o.orderId === order.orderId);
        if (existing >= 0) book[existing] = order;
        else book.push(order);
        return order;
      }),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock(book)),
    };

    tradeRepo = {
      create: jest.fn((data: Partial<SecondaryTrade>) => data),
      save: jest.fn(async (trade: SecondaryTrade) => trade),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        makeUser(where.id),
      ),
    };

    sorobanService = {
      invokeMarketplaceSettlement: jest.fn().mockResolvedValue('tx-hash-abc'),
    };

    queueService = { emit: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceSettlementService,
        { provide: getRepositoryToken(SecondaryTrade), useValue: tradeRepo },
        { provide: getRepositoryToken(SecondaryOrder), useValue: orderRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: SorobanService, useValue: sorobanService },
        { provide: QueueService, useValue: queueService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) =>
              key === 'MARKETPLACE_SETTLEMENT_CONTRACT'
                ? 'CSETTLEMENT123'
                : key === 'MARKETPLACE_PLATFORM_FEE_BPS'
                  ? PLATFORM_FEE_BPS
                  : fallback,
            ),
          },
        },
        { provide: DataSource, useValue: {} },
        { provide: PinoLogger, useValue: makeLogger() },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceSettlementService);
  });

  function makeUser(id: string): User {
    return { id, walletAddress: `${id}-wallet` } as User;
  }

  function makeLogger() {
    return {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    };
  }

  /** Simulates a settled trade, which is the market price stop orders watch. */
  function setMarketPrice(price: number): void {
    tradeRepo.findOne.mockImplementation(async () => ({
      pricePerToken: price,
      status: SecondaryTradeStatus.SETTLED,
    }));
  }

  beforeEach(() => {
    // Default: no market price yet.
    tradeRepo.findOne.mockResolvedValue(null);
    orderRepo.findOne.mockImplementation(
      async ({ where }: { where: Partial<SecondaryOrder> }) =>
        book.find((o) =>
          Object.entries(where).every(
            ([k, v]) => (o as unknown as Record<string, unknown>)[k] === v,
          ),
        ) ?? null,
    );
    orderRepo.find.mockResolvedValue([]);
    orderRepo.findAndCount.mockResolvedValue([[], 0]);
  });

  // ─── Fill-or-kill ───────────────────────────────────────────────────────

  describe('fill-or-kill', () => {
    it('fills the whole size when the book can absorb it', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 60,
        }),
        makeOrder({
          orderId: 'resting-2',
          userId: 'user-c',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10.5,
          tokenAmount: 40,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.FOK,
        tokenAmount: 100,
        pricePerToken: 10.5,
      } as never);

      expect(result.killed).toBe(false);
      expect(result.filled).toBe(true);
      expect(result.order.status).toBe(SecondaryOrderStatus.FILLED);
      expect(result.order.filledAmount).toBe(100);
      expect(result.fills).toHaveLength(2);
      expect(sorobanService.invokeMarketplaceSettlement).toHaveBeenCalledTimes(
        2,
      );
    });

    it('cancels outright when only part of the size is available', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 30,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.FOK,
        tokenAmount: 100,
        pricePerToken: 10,
      } as never);

      expect(result.killed).toBe(true);
      expect(result.filled).toBe(false);
      expect(result.fills).toHaveLength(0);
      expect(result.order.status).toBe(SecondaryOrderStatus.CANCELLED);
      expect(result.order.cancelReason).toBe('fok_no_liquidity');
      expect(result.order.filledAmount).toBe(0);
      // Nothing settled and the maker's size is untouched.
      expect(sorobanService.invokeMarketplaceSettlement).not.toHaveBeenCalled();
      expect(book[0].filledAmount).toBe(0);
    });

    it('cancels when the book is empty', async () => {
      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.SELL,
        type: SecondaryOrderType.FOK,
        tokenAmount: 10,
        pricePerToken: 10,
      } as never);

      expect(result.killed).toBe(true);
      expect(result.order.status).toBe(SecondaryOrderStatus.CANCELLED);
      expect(result.bestOpposingPrice).toBeNull();
    });

    it('ignores makers priced above the taker limit', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 12,
          tokenAmount: 500,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.FOK,
        tokenAmount: 10,
        pricePerToken: 11,
      } as never);

      expect(result.killed).toBe(true);
    });

    it('does not count the taker own resting orders as liquidity', async () => {
      book.push(
        makeOrder({
          orderId: 'own-order',
          userId: 'user-a',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 500,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.FOK,
        tokenAmount: 10,
        pricePerToken: 10,
      } as never);

      expect(result.killed).toBe(true);
      expect(sorobanService.invokeMarketplaceSettlement).not.toHaveBeenCalled();
    });
  });

  // ─── Limit orders / partial fills ───────────────────────────────────────

  describe('limit orders', () => {
    it('fills partially and leaves the remainder on the book', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 40,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.LIMIT,
        tokenAmount: 100,
        pricePerToken: 10,
      } as never);

      expect(result.filled).toBe(false);
      expect(result.killed).toBe(false);
      expect(result.order.status).toBe(SecondaryOrderStatus.PARTIALLY_FILLED);
      expect(result.order.filledAmount).toBe(40);
      expect(result.fills).toHaveLength(1);
      // The maker is now fully filled and leaves the book.
      expect(book[0].status).toBe(SecondaryOrderStatus.FILLED);
    });

    it('consumes makers in price-time priority', async () => {
      book.push(
        makeOrder({
          orderId: 'late-cheap',
          userId: 'user-c',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 9,
          tokenAmount: 10,
          createdAt: new Date('2024-01-15T10:05:00Z'),
        }),
        makeOrder({
          orderId: 'early-cheap',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 9,
          tokenAmount: 10,
          createdAt: new Date('2024-01-15T10:01:00Z'),
        }),
        makeOrder({
          orderId: 'best-price',
          userId: 'user-d',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 8,
          tokenAmount: 5,
          createdAt: new Date('2024-01-15T10:09:00Z'),
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.LIMIT,
        tokenAmount: 20,
        pricePerToken: 10,
      } as never);

      expect(result.fills.map((f) => f.makerOrderId)).toEqual([
        'best-price',
        'early-cheap',
      ]);
      expect(result.filled).toBe(true);
    });

    it('charges platform fees on each fill at the maker price', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 100,
        }),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.LIMIT,
        tokenAmount: 100,
        pricePerToken: 10,
      } as never);

      const trade = result.fills[0].trade as SecondaryTrade;
      expect(Number(trade.totalAmountUsd)).toBe(1000);
      expect(Number(trade.platformFeeUsd)).toBe(20);
      expect(Number(trade.netAmountUsd)).toBe(980);
      expect(trade.status).toBe(SecondaryTradeStatus.SETTLED);
      expect(trade.sellerId).toBe('user-b');
      expect(trade.buyerId).toBe('user-a');
    });

    it('leaves the size on the book when on-chain settlement fails', async () => {
      book.push(
        makeOrder({
          orderId: 'resting-1',
          userId: 'user-b',
          side: SecondaryOrderSide.SELL,
          pricePerToken: 10,
          tokenAmount: 100,
        }),
      );
      sorobanService.invokeMarketplaceSettlement.mockRejectedValue(
        new Error('Contract rejected'),
      );

      const result = await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.BUY,
        type: SecondaryOrderType.LIMIT,
        tokenAmount: 100,
        pricePerToken: 10,
      } as never);

      expect(result.fills).toHaveLength(0);
      expect(result.order.filledAmount).toBe(0);
      expect(result.order.status).not.toBe(SecondaryOrderStatus.FILLED);
    });
  });

  // ─── Stop-loss trigger semantics ────────────────────────────────────────

  describe('stop-loss triggers', () => {
    const stop = (overrides: Partial<SecondaryOrder> = {}) =>
      makeOrder({
        orderId: 'stop-1',
        userId: 'user-a',
        side: SecondaryOrderSide.SELL,
        type: SecondaryOrderType.STOP_LOSS,
        triggerPrice: 9,
        stopDirection: StopLossDirection.BELOW,
        pricePerToken: 9,
        tokenAmount: 50,
        ...overrides,
      });

    it('arms a sell stop when the market falls to the trigger', async () => {
      setMarketPrice(9);
      book.push(stop());

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(true);
      expect(result.order.status).not.toBe(SecondaryOrderStatus.OPEN);
      expect(result.order.triggeredAt).toBeInstanceOf(Date);
    });

    it('arms a sell stop when the market falls through the trigger', async () => {
      setMarketPrice(7.5);
      book.push(stop());

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(true);
    });

    it('does not arm a sell stop while the market is above the trigger', async () => {
      setMarketPrice(9.5);
      book.push(stop());

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(false);
      expect(result.order.status).toBe(SecondaryOrderStatus.OPEN);
      expect(result.order.triggeredAt).toBeNull();
    });

    it('arms a buy stop when the market rises to the trigger', async () => {
      setMarketPrice(11);
      book.push(
        stop({
          orderId: 'stop-buy',
          side: SecondaryOrderSide.BUY,
          pricePerToken: 11,
          stopDirection: StopLossDirection.ABOVE,
        }),
      );

      const result = await service.matchOrder('stop-buy');

      expect(result.triggered).toBe(true);
    });

    it('does not arm a buy stop while the market is below the trigger', async () => {
      setMarketPrice(10.9);
      book.push(
        stop({
          orderId: 'stop-buy',
          side: SecondaryOrderSide.BUY,
          stopDirection: StopLossDirection.ABOVE,
        }),
      );

      const result = await service.matchOrder('stop-buy');

      expect(result.triggered).toBe(false);
      expect(result.order.triggeredAt).toBeNull();
    });

    it('ignores crossing in the wrong direction', async () => {
      // A sell stop (below) must not arm when the market rises through it.
      setMarketPrice(50);
      book.push(
        stop({ triggerPrice: 9, stopDirection: StopLossDirection.BELOW }),
      );

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(false);
    });

    it('stays dormant when there is no market price yet', async () => {
      tradeRepo.findOne.mockResolvedValue(null);
      book.push(stop());

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(false);
      expect(result.order.status).toBe(SecondaryOrderStatus.OPEN);
    });

    it('defaults the cross direction by side', async () => {
      setMarketPrice(8);

      await service.createOrder('user-a', {
        tokenCode: 'FARM001',
        side: SecondaryOrderSide.SELL,
        type: SecondaryOrderType.STOP_LOSS,
        tokenAmount: 10,
        pricePerToken: 8,
        triggerPrice: 9,
      } as never);

      const created = book[book.length - 1];
      expect(created.stopDirection).toBe(StopLossDirection.BELOW);
    });

    it('requires a trigger price', async () => {
      await expect(
        service.createOrder('user-a', {
          tokenCode: 'FARM001',
          side: SecondaryOrderSide.SELL,
          type: SecondaryOrderType.STOP_LOSS,
          tokenAmount: 10,
          pricePerToken: 8,
        } as never),
      ).rejects.toThrow('triggerPrice is required');
    });

    it('rejects a stop whose trigger the market already crossed', async () => {
      setMarketPrice(5);

      await expect(
        service.createOrder('user-a', {
          tokenCode: 'FARM001',
          side: SecondaryOrderSide.SELL,
          type: SecondaryOrderType.STOP_LOSS,
          tokenAmount: 10,
          pricePerToken: 4,
          triggerPrice: 9,
        } as never),
      ).rejects.toThrow(/already crossed/);
    });

    it('enters normal matching once armed', async () => {
      setMarketPrice(8);
      book.push(
        makeOrder({
          orderId: 'resting-buy',
          userId: 'user-b',
          side: SecondaryOrderSide.BUY,
          pricePerToken: 9,
          tokenAmount: 50,
        }),
        stop(),
      );

      const result = await service.matchOrder('stop-1');

      expect(result.triggered).toBe(true);
      expect(result.filled).toBe(true);
      expect(result.order.status).toBe(SecondaryOrderStatus.FILLED);
      expect(result.fills).toHaveLength(1);
    });

    it('is not matchable against the book before it arms', async () => {
      setMarketPrice(20);
      book.push(
        makeOrder({
          orderId: 'resting-buy',
          userId: 'user-b',
          side: SecondaryOrderSide.BUY,
          pricePerToken: 9,
          tokenAmount: 50,
        }),
        stop(),
      );

      const result = await service.matchOrder('stop-1');

      expect(result.fills).toHaveLength(0);
      expect(result.order.status).toBe(SecondaryOrderStatus.OPEN);
    });
  });

  // ─── Sweep-level trigger arming ─────────────────────────────────────────

  describe('processStopLossTriggers', () => {
    it('arms every dormant stop the market has crossed', async () => {
      setMarketPrice(8);
      orderRepo.find.mockResolvedValue([
        makeOrder({
          orderId: 'stop-1',
          type: SecondaryOrderType.STOP_LOSS,
          triggerPrice: 9,
          stopDirection: StopLossDirection.BELOW,
        }),
        makeOrder({
          orderId: 'stop-2',
          userId: 'user-b',
          type: SecondaryOrderType.STOP_LOSS,
          triggerPrice: 8.5,
          stopDirection: StopLossDirection.BELOW,
        }),
        makeOrder({
          orderId: 'stop-3',
          userId: 'user-c',
          type: SecondaryOrderType.STOP_LOSS,
          triggerPrice: 7,
          stopDirection: StopLossDirection.BELOW,
        }),
      ]);

      const armed = await service.processStopLossTriggers('FARM001');

      expect(armed.map((o) => o.orderId)).toEqual(['stop-1', 'stop-2']);
      expect(armed[0].status).toBe(SecondaryOrderStatus.TRIGGERED);
      expect(queueService.emit).toHaveBeenCalledWith(
        'secondary_order.triggered',
        expect.objectContaining({ orderId: 'stop-1' }),
      );
    });

    it('arms nothing on a cold market', async () => {
      tradeRepo.findOne.mockResolvedValue(null);
      orderRepo.find.mockResolvedValue([
        makeOrder({
          orderId: 'stop-1',
          type: SecondaryOrderType.STOP_LOSS,
          triggerPrice: 9,
          stopDirection: StopLossDirection.BELOW,
        }),
      ]);

      await expect(service.processStopLossTriggers('FARM001')).resolves.toEqual(
        [],
      );
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  describe('order lifecycle', () => {
    it('expires a resting order past its expiry before matching', async () => {
      const stale = makeOrder({
        orderId: 'stale',
        expiresAt: new Date(Date.now() - 60_000),
      });
      book.push(stale);

      const result = await service.matchOrder('stale');

      expect(result.order.status).toBe(SecondaryOrderStatus.EXPIRED);
      expect(result.order.cancelReason).toBe('expired');
      expect(result.fills).toHaveLength(0);
    });

    it('expires an armed stop order before matching', async () => {
      setMarketPrice(1);
      book.push(
        makeOrder({
          orderId: 'stale-stop',
          type: SecondaryOrderType.STOP_LOSS,
          triggerPrice: 9,
          stopDirection: StopLossDirection.BELOW,
          triggeredAt: new Date(),
          status: SecondaryOrderStatus.TRIGGERED,
          expiresAt: new Date(Date.now() - 1_000),
        }),
      );

      const result = await service.matchOrder('stale-stop');

      expect(result.order.status).toBe(SecondaryOrderStatus.EXPIRED);
    });

    it('does not re-match a terminal order', async () => {
      book.push(
        makeOrder({
          orderId: 'done',
          status: SecondaryOrderStatus.FILLED,
        }),
      );

      const result = await service.matchOrder('done');

      expect(result.fills).toHaveLength(0);
      expect(result.filled).toBe(false);
    });

    it('cancels a resting order owned by the maker', async () => {
      book.push(makeOrder({ orderId: 'mine', userId: 'user-a' }));

      const cancelled = await service.cancelOrder('mine', 'user-a', {
        reason: 'user_requested',
      });

      expect(cancelled.status).toBe(SecondaryOrderStatus.CANCELLED);
      expect(cancelled.cancelReason).toBe('user_requested');
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    });

    it('rejects cancellation by a non-maker', async () => {
      book.push(makeOrder({ orderId: 'mine', userId: 'user-a' }));

      await expect(service.cancelOrder('mine', 'user-b')).rejects.toThrow(
        'Only the maker can cancel',
      );
    });

    it('rejects cancellation of a filled order', async () => {
      book.push(
        makeOrder({
          orderId: 'done',
          status: SecondaryOrderStatus.FILLED,
        }),
      );

      await expect(service.cancelOrder('done', 'user-maker')).rejects.toThrow(
        'can no longer be cancelled',
      );
    });

    it('requires the user to have a linked wallet', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-a' } as User);

      await expect(
        service.createOrder('user-a', {
          tokenCode: 'FARM001',
          side: SecondaryOrderSide.SELL,
          type: SecondaryOrderType.LIMIT,
          tokenAmount: 1,
          pricePerToken: 1,
        } as never),
      ).rejects.toThrow('no linked wallet');
    });

    it('rejects non-positive amounts and prices', async () => {
      await expect(
        service.createOrder('user-a', {
          tokenCode: 'FARM001',
          side: SecondaryOrderSide.SELL,
          type: SecondaryOrderType.LIMIT,
          tokenAmount: 0,
          pricePerToken: 1,
        } as never),
      ).rejects.toThrow('tokenAmount must be greater than zero');

      await expect(
        service.createOrder('user-a', {
          tokenCode: 'FARM001',
          side: SecondaryOrderSide.SELL,
          type: SecondaryOrderType.LIMIT,
          tokenAmount: 1,
          pricePerToken: 0,
        } as never),
      ).rejects.toThrow('pricePerToken must be greater than zero');
    });
  });

  // ─── Order book aggregation ─────────────────────────────────────────────

  describe('getOrderBook', () => {
    it('aggregates resting size per price level and sorts both sides', async () => {
      orderRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(
          levelQueryBuilder([
            {
              side: 'buy',
              pricePerToken: '9.5',
              tokenAmount: '10',
              filledAmount: '0',
            },
            {
              side: 'buy',
              pricePerToken: '9.5',
              tokenAmount: '15',
              filledAmount: '5',
            },
            {
              side: 'buy',
              pricePerToken: '9.0',
              tokenAmount: '4',
              filledAmount: '0',
            },
          ]),
        )
        .mockReturnValueOnce(
          levelQueryBuilder([
            {
              side: 'sell',
              pricePerToken: '10.5',
              tokenAmount: '8',
              filledAmount: '0',
            },
            {
              side: 'sell',
              pricePerToken: '10.0',
              tokenAmount: '2',
              filledAmount: '0',
            },
          ]),
        );

      const snapshot = await service.getOrderBook('FARM001');

      expect(snapshot.bids).toEqual([
        { pricePerToken: 9.5, amount: 20, orderCount: 2 },
        { pricePerToken: 9, amount: 4, orderCount: 1 },
      ]);
      expect(snapshot.asks).toEqual([
        { pricePerToken: 10.5, amount: 8, orderCount: 1 },
        { pricePerToken: 10, amount: 2, orderCount: 1 },
      ]);
    });

    it('reports the last settled price so clients can render a stop marker', async () => {
      orderRepo.createQueryBuilder = jest.fn(() => levelQueryBuilder([]));
      tradeRepo.findOne.mockResolvedValue({
        pricePerToken: 10.25,
        status: SecondaryTradeStatus.SETTLED,
      });

      const snapshot = await service.getOrderBook('FARM001');

      expect(snapshot.lastPrice).toBe(10.25);
    });
  });

  function levelQueryBuilder(rows: Record<string, string>[]) {
    return {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => rows),
    };
  }
});

/**
 * Minimal QueryBuilder stand-in that understands the WHERE clauses the
 * matching engine relies on, so the tests exercise real crossing / price-time
 * selection rather than a hand-fed list.
 */
function createQueryBuilderMock(book: SecondaryOrder[]) {
  const state = {
    tokenCode: null as string | null,
    side: null as string | null,
    statuses: [] as string[],
    priceOp: null as string | null,
    price: null as number | null,
    isBuy: true,
    take: 100,
  };

  const qb = {
    where(clause: string, params: Record<string, unknown>) {
      if (clause.includes('o.token_code') || clause.includes('m.token_code'))
        state.tokenCode = params.tokenCode as string;
      if (clause.includes('.side =')) state.side = params.side as string;
      return qb;
    },
    andWhere(clause: string, params: Record<string, unknown> = {}) {
      if (clause.includes('status IN')) {
        state.statuses = params.statuses as string[];
      }
      if (clause.includes('price_per_token <=')) {
        state.priceOp = '<=';
        state.price = params.price as number;
        state.isBuy = true;
      }
      if (clause.includes('price_per_token >=')) {
        state.priceOp = '>=';
        state.price = params.price as number;
        state.isBuy = false;
      }
      return qb;
    },
    orderBy() {
      return qb;
    },
    addOrderBy() {
      return qb;
    },
    take(n: number) {
      state.take = n;
      return qb;
    },
    select() {
      return qb;
    },
    getRawMany: jest.fn(async () => []),
    getMany: jest.fn(async () => {
      const now = Date.now();
      const matched = book.filter((o) => {
        if (state.tokenCode && o.tokenCode !== state.tokenCode) return false;
        if (state.side && o.side !== state.side) return false;
        if (state.statuses.length && !state.statuses.includes(o.status))
          return false;
        if (Number(o.filledAmount) >= Number(o.tokenAmount)) return false;
        if (o.expiresAt && new Date(o.expiresAt).getTime() <= now) return false;
        if (o.type === SecondaryOrderType.STOP_LOSS && !o.triggeredAt)
          return false;
        if (state.priceOp === '<=' && Number(o.pricePerToken) > state.price!)
          return false;
        if (state.priceOp === '>=' && Number(o.pricePerToken) < state.price!)
          return false;
        return true;
      });

      matched.sort((a, b) => {
        const pa = Number(a.pricePerToken);
        const pb = Number(b.pricePerToken);
        if (pa !== pb) return state.isBuy ? pa - pb : pb - pa;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      return matched.slice(0, state.take);
    }),
  };

  return qb;
}
