import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { SecondaryOrderMatchingService } from './secondary-order-matching.service';
import {
  MarketplaceSettlementService,
  MatchOrderResult,
} from './marketplace-settlement.service';
import { SecondaryOrderStatus } from './entities/secondary-order.entity';

function result(overrides: Partial<MatchOrderResult> = {}): MatchOrderResult {
  return {
    order: { status: SecondaryOrderStatus.OPEN } as never,
    triggered: false,
    killed: false,
    filled: false,
    fills: [],
    bestOpposingPrice: null,
    ...overrides,
  };
}

describe('SecondaryOrderMatchingService', () => {
  let service: SecondaryOrderMatchingService;
  let settlementService: {
    getActiveTokenCodes: jest.Mock;
    matchOpenOrders: jest.Mock;
  };
  let logger: Record<string, jest.Mock>;

  beforeEach(async () => {
    settlementService = {
      getActiveTokenCodes: jest.fn().mockResolvedValue([]),
      matchOpenOrders: jest.fn().mockResolvedValue([]),
    };

    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecondaryOrderMatchingService,
        {
          provide: MarketplaceSettlementService,
          useValue: settlementService,
        },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    service = moduleRef.get(SecondaryOrderMatchingService);
  });

  it('does nothing when no tokens have live orders', async () => {
    settlementService.getActiveTokenCodes.mockResolvedValue([]);

    await service.runScheduledMatching();

    expect(settlementService.matchOpenOrders).not.toHaveBeenCalled();
  });

  it('matches every active token', async () => {
    settlementService.getActiveTokenCodes.mockResolvedValue([
      'FARM001',
      'FARM002',
    ]);

    await service.runScheduledMatching();

    expect(settlementService.matchOpenOrders).toHaveBeenCalledTimes(2);
    expect(settlementService.matchOpenOrders).toHaveBeenNthCalledWith(
      1,
      'FARM001',
    );
    expect(settlementService.matchOpenOrders).toHaveBeenNthCalledWith(
      2,
      'FARM002',
    );
  });

  it('contains a failure for one token so the others still run', async () => {
    settlementService.getActiveTokenCodes.mockResolvedValue([
      'FARM001',
      'FARM002',
    ]);
    settlementService.matchOpenOrders
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce([]);

    await expect(service.runScheduledMatching()).resolves.toBeUndefined();

    expect(settlementService.matchOpenOrders).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tokenCode: 'FARM001' }),
      expect.any(String),
    );
  });

  it('swallows a failure to list active tokens', async () => {
    settlementService.getActiveTokenCodes.mockRejectedValue(
      new Error('db down'),
    );

    await expect(service.runScheduledMatching()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('skips a tick that overlaps with a running sweep', async () => {
    let release: () => void = () => undefined;
    settlementService.getActiveTokenCodes.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          release = () => resolve(['FARM001']);
        }),
    );

    const first = service.runScheduledMatching();
    await service.runScheduledMatching();

    expect(settlementService.matchOpenOrders).not.toHaveBeenCalled();

    release();
    await first;

    expect(settlementService.matchOpenOrders).toHaveBeenCalledTimes(1);
  });

  it('logs an aggregate summary for a sweep that changed the book', async () => {
    settlementService.getActiveTokenCodes.mockResolvedValue(['FARM001']);
    settlementService.matchOpenOrders.mockResolvedValue([
      result({ triggered: true, filled: true }),
      result({ killed: true }),
      result({
        fills: [
          {
            takerOrderId: 'a',
            makerOrderId: 'b',
            tokenCode: 'FARM001',
            amount: 5,
            pricePerToken: 10,
            trade: {} as never,
            txHash: 'tx',
          },
        ],
      }),
      result(),
    ]);

    await service.runScheduledMatching();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenCode: 'FARM001',
        triggered: 1,
        filled: 1,
        killed: 1,
        partiallyFilled: 1,
      }),
      'Secondary matching sweep complete',
    );
  });

  it('stays quiet when a sweep changed nothing', async () => {
    settlementService.getActiveTokenCodes.mockResolvedValue(['FARM001']);
    settlementService.matchOpenOrders.mockResolvedValue([result(), result()]);

    await service.runScheduledMatching();

    expect(logger.info).not.toHaveBeenCalled();
  });
});
