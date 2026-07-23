import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios from 'axios';
import {
  PRICE_REDIS_CLIENT,
  PricesService,
  XLM_USDC_PRICE_CACHE_KEY,
} from './prices.service';

jest.mock('axios');

describe('PricesService', () => {
  let service: PricesService;
  let redisClient: {
    isOpen: boolean;
    connect: jest.Mock;
    quit: jest.Mock;
    get: jest.Mock;
    setEx: jest.Mock;
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      const values: Record<string, string> = {
        XLM_USDC_PRICE_TIMEOUT_MS: '5000',
        XLM_USDC_PRICE_REFRESH_INTERVAL_MS: '60000',
        XLM_USDC_FALLBACK_RATE: '0.1',
      };

      return values[key] ?? defaultValue ?? '';
    }),
  };

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redisClient = {
      isOpen: true,
      connect: jest.fn(),
      quit: jest.fn(),
      get: jest.fn(),
      setEx: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricesService,
        { provide: ConfigService, useValue: configService },
        { provide: PinoLogger, useValue: logger },
        { provide: PRICE_REDIS_CLIENT, useValue: redisClient },
      ],
    }).compile();

    service = module.get<PricesService>(PricesService);
  });

  it('returns the cached rate when Redis has a value', async () => {
    redisClient.get.mockResolvedValue(
      JSON.stringify({
        rate: 0.135,
        source: 'coingecko',
        fetchedAt: new Date().toISOString(),
      }),
    );

    const rate = await service.getXlmUsdcRate();

    expect(rate).toBe(0.135);
    expect(redisClient.get).toHaveBeenCalledWith(XLM_USDC_PRICE_CACHE_KEY);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetches a live rate and stores it in Redis when cache is empty', async () => {
    redisClient.get.mockResolvedValue(null);
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        'stellar-lumen': { usd: 0.14 },
        'usd-coin': { usd: 1 },
      },
    });

    const rate = await service.getXlmUsdcRate();

    expect(rate).toBeCloseTo(0.14, 5);
    expect(redisClient.setEx).toHaveBeenCalledWith(
      XLM_USDC_PRICE_CACHE_KEY,
      60,
      expect.stringContaining('"rate":0.14'),
    );
  });

  it('falls back to the last known cached rate when the API times out', async () => {
    redisClient.get.mockResolvedValue(
      JSON.stringify({
        rate: 0.13,
        source: 'coingecko',
        fetchedAt: new Date().toISOString(),
      }),
    );

    (axios.get as jest.Mock).mockRejectedValue(
      new Error('timeout of 5000ms exceeded'),
    );

    const rate = await service.refreshAndCachePrice('manual');

    expect(rate).toBe(0.13);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRate: 0.13,
      }),
      expect.stringContaining('Using fallback XLM/USDC price feed'),
    );
  });

  it('falls back to the configured static rate when both API and cache are unavailable', async () => {
    redisClient.get.mockResolvedValue(null);
    (axios.get as jest.Mock).mockRejectedValue(new Error('request timed out'));

    const rate = await service.refreshAndCachePrice('manual');

    expect(rate).toBe(0.1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRate: 0.1,
      }),
      expect.stringContaining('Using fallback XLM/USDC price feed'),
    );
  });
});
