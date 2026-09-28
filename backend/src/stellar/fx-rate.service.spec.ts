import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios from 'axios';
import {
  FxRateService,
  FX_RATES_CACHE_KEY,
  SUPPORTED_CURRENCIES,
} from './fx-rate.service';
import { RedisClientType } from 'redis';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FxRateService', () => {
  let service: FxRateService;
  let configService: ConfigService;
  let logger: PinoLogger;
  let redisClient: jest.Mocked<Partial<RedisClientType>>;

  const mockRates = {
    KES: 130.0,
    NGN: 1500.0,
    GHS: 13.5,
    TZS: 2650.0,
  };

  const mockApiResponse = {
    data: {
      base_code: 'USD',
      conversion_rates: {
        KES: 130.0,
        NGN: 1500.0,
        GHS: 13.5,
        TZS: 2650.0,
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.79,
      },
    },
  };

  beforeEach(async () => {
    redisClient = {
      isOpen: false,
      get: jest.fn(),
      setEx: jest.fn(),
      connect: jest.fn(),
      quit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxRateService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                FX_RATE_REFRESH_INTERVAL_MS: 3600_000,
                FX_API_TIMEOUT_MS: 10_000,
                FX_CACHE_TTL_SECONDS: 3600,
                FX_FALLBACK_KES: 130.0,
                FX_FALLBACK_NGN: 1500.0,
                FX_FALLBACK_GHS: 13.5,
                FX_FALLBACK_TZS: 2650.0,
                FX_API_KEY: 'test-api-key',
                FX_API_URL: 'https://v6.exchangerate-api.com/v6',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
        {
          provide: 'FX_REDIS_CLIENT',
          useValue: redisClient,
        },
      ],
    }).compile();

    service = module.get<FxRateService>(FxRateService);
    configService = module.get<ConfigService>(ConfigService);
    logger = module.get<PinoLogger>(PinoLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (service['refreshTimer']) {
      clearInterval(service['refreshTimer']);
    }
  });

  describe('getExchangeRates', () => {
    it('should fetch rates from API on first call', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toEqual(mockRates);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://v6.exchangerate-api.com/v6/test-api-key/latest/USD',
        expect.objectContaining({
          timeout: 10_000,
        }),
      );
      expect(redisClient.setEx).toHaveBeenCalled();
    });

    it('should return cached rates when available', async () => {
      const cachedSnapshot = JSON.stringify({
        rates: mockRates,
        source: 'exchangerate-api',
        fetchedAt: new Date().toISOString(),
      });

      (redisClient.get as jest.Mock).mockResolvedValueOnce(cachedSnapshot);

      const rates = await service.getExchangeRates();

      expect(rates).toEqual(mockRates);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should return fallback rates on API error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toEqual({
        KES: 130.0,
        NGN: 1500.0,
        GHS: 13.5,
        TZS: 2650.0,
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return cached rates if API fails after previous success', async () => {
      // First call: successful fetch
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          JSON.stringify({
            rates: mockRates,
            source: 'exchangerate-api',
            fetchedAt: new Date().toISOString(),
          }),
        );

      await service.getExchangeRates();

      // Second call: API fails, cache hit
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));
      (redisClient.get as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          rates: mockRates,
          source: 'exchangerate-api',
          fetchedAt: new Date().toISOString(),
        }),
      );

      const rates = await service.getExchangeRates();
      expect(rates).toEqual(mockRates);
    });
  });

  describe('convertUsdToLocal', () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);
    });

    it('should convert USD to KES correctly', async () => {
      const amount = await service.convertUsdToLocal(100, 'KES');
      expect(amount).toBe(13000.0);
    });

    it('should convert USD to NGN correctly', async () => {
      const amount = await service.convertUsdToLocal(50, 'NGN');
      expect(amount).toBe(75000.0);
    });

    it('should convert USD to GHS correctly', async () => {
      const amount = await service.convertUsdToLocal(1000, 'GHS');
      expect(amount).toBe(13500.0);
    });

    it('should convert USD to TZS correctly', async () => {
      const amount = await service.convertUsdToLocal(10, 'TZS');
      expect(amount).toBe(26500.0);
    });

    it('should throw error for unsupported currency', async () => {
      await expect(
        service.convertUsdToLocal(100, 'EUR' as any),
      ).rejects.toThrow('Unsupported currency');
    });

    it('should throw error for negative amount', async () => {
      await expect(service.convertUsdToLocal(-100, 'KES')).rejects.toThrow(
        'Amount must be non-negative',
      );
    });

    it('should handle zero amount', async () => {
      const amount = await service.convertUsdToLocal(0, 'KES');
      expect(amount).toBe(0.0);
    });

    it('should round to 2 decimal places', async () => {
      const amount = await service.convertUsdToLocal(123.456, 'KES');
      expect(amount).toBe(16049.28);
    });
  });

  describe('convertUsdToMultipleCurrencies', () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);
    });

    it('should convert to all supported currencies', async () => {
      const amounts = await service.convertUsdToMultipleCurrencies(100);

      expect(amounts).toEqual({
        KES: 13000.0,
        NGN: 150000.0,
        GHS: 1350.0,
        TZS: 265000.0,
      });
    });

    it('should convert to subset of currencies', async () => {
      const amounts = await service.convertUsdToMultipleCurrencies(50, [
        'KES',
        'NGN',
      ]);

      expect(amounts).toEqual({
        KES: 6500.0,
        NGN: 75000.0,
      });
    });
  });

  describe('Redis caching', () => {
    it('should cache rates with TTL', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      await service.getExchangeRates();

      expect(redisClient.setEx).toHaveBeenCalledWith(
        FX_RATES_CACHE_KEY,
        3600,
        expect.stringContaining('KES'),
      );
    });

    it('should handle missing Redis client gracefully', async () => {
      const serviceWithoutRedis = new FxRateService(
        configService,
        logger,
        null,
      );

      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);

      const rates = await serviceWithoutRedis.getExchangeRates();
      expect(rates).toEqual(mockRates);
    });

    it('should invalidate corrupt cache entries', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock)
        .mockResolvedValueOnce('invalid-json')
        .mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toEqual(mockRates);
      expect(mockedAxios.get).toHaveBeenCalled();
    });

    it('should invalidate cache with missing rates', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock)
        .mockResolvedValueOnce(
          JSON.stringify({
            rates: { KES: 130.0 }, // Missing NGN, GHS, TZS
            source: 'cache',
            fetchedAt: new Date().toISOString(),
          }),
        )
        .mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toEqual(mockRates);
      expect(mockedAxios.get).toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    it('should handle network timeout', async () => {
      mockedAxios.get.mockRejectedValueOnce(
        new Error('ECONNABORTED: Request timeout'),
      );
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toBeDefined();
      expect(Object.keys(rates).length).toBeGreaterThan(0);
    });

    it('should handle API returning invalid structure', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          conversion_rates: null, // Invalid
        },
      });
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle API missing required currency', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          base_code: 'USD',
          conversion_rates: {
            NGN: 1500.0,
            GHS: 13.5,
            TZS: 2650.0,
            // KES is missing!
          },
        },
      });
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle zero/negative rates from API', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          base_code: 'USD',
          conversion_rates: {
            KES: -130.0, // Invalid negative rate
            NGN: 1500.0,
            GHS: 13.5,
            TZS: 2650.0,
          },
        },
      });
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('lifecycle hooks', () => {
    it('should refresh rates on module init', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      await service.onModuleInit();

      expect(mockedAxios.get).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'startup' }),
        'Refreshed FX exchange rates',
      );
    });

    it('should set up refresh interval', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        3600_000,
      );

      setIntervalSpy.mockRestore();
    });

    it('should clean up on module destroy', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(redisClient.quit).toHaveBeenCalled();
    });

    it('should handle missing Redis client on destroy', async () => {
      const serviceWithoutRedis = new FxRateService(
        configService,
        logger,
        null,
      );
      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);

      await serviceWithoutRedis.onModuleInit();
      await expect(
        serviceWithoutRedis.onModuleDestroy(),
      ).resolves.not.toThrow();
    });
  });

  describe('config parsing', () => {
    it('should parse numeric config values from strings', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'FX_API_TIMEOUT_MS') return '5000'; // String
        if (key === 'FX_CACHE_TTL_SECONDS') return '7200'; // String
        return mockRates[key as keyof typeof mockRates];
      });

      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();
      expect(rates).toEqual(mockRates);
    });

    it('should handle invalid numeric config with fallbacks', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'FX_API_TIMEOUT_MS') return 'invalid'; // Invalid
        if (key === 'FX_CACHE_TTL_SECONDS') return null;
        return undefined;
      });

      mockedAxios.get.mockResolvedValueOnce(mockApiResponse);
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      await service.getExchangeRates();

      // Should fall back to defaults - API should still be called
      expect(mockedAxios.get).toHaveBeenCalled();
    });
  });

  describe('fallback rates', () => {
    it('should use configured fallback rates', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));
      (redisClient.get as jest.Mock).mockResolvedValueOnce(null);

      const rates = await service.getExchangeRates();

      expect(rates.KES).toBe(130.0);
      expect(rates.NGN).toBe(1500.0);
      expect(rates.GHS).toBe(13.5);
      expect(rates.TZS).toBe(2650.0);
    });

    it('should use in-memory fallback when Redis unavailable', async () => {
      const serviceWithoutRedis = new FxRateService(
        configService,
        logger,
        null,
      );

      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      const rates = await serviceWithoutRedis.getExchangeRates();

      expect(rates).toEqual({
        KES: 130.0,
        NGN: 1500.0,
        GHS: 13.5,
        TZS: 2650.0,
      });
    });
  });
});
