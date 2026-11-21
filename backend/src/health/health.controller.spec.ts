import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheckError,
} from '@nestjs/terminus';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import { StellarHealthIndicator } from './stellar.health-indicator';
import { DocumentScanHealthIndicator } from './document-scan.health-indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let health: HealthCheckService;

  const mockHealthCheckService = {
    check: jest.fn((indicators: Array<() => Promise<unknown>>) =>
      Promise.all(indicators.map((indicator) => indicator())),
    ),
  };
  const mockDbIndicator = {
    pingCheck: jest.fn(),
  };
  const mockRabbitmqIndicator = {
    isHealthy: jest.fn(),
  };
  const mockMemoryIndicator = {
    checkHeap: jest.fn(),
    checkRSS: jest.fn(),
  };
  const mockDiskIndicator = {
    checkStorage: jest.fn(),
  };
  const mockRedisIndicator = {
    isHealthy: jest.fn(),
  };
  const mockStellarIndicator = {
    isHealthy: jest.fn(),
  };
  const mockDocumentScanIndicator = {
    isHealthy: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        // MetricsIpGuard (used by /health/detail) reads its IP allowlist via
        // ConfigService.
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (_key: string, defaultValue?: unknown) => defaultValue,
            ),
          },
        },
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDbIndicator },
        {
          provide: RabbitmqHealthIndicator,
          useValue: mockRabbitmqIndicator,
        },
        { provide: RedisHealthIndicator, useValue: mockRedisIndicator },
        { provide: StellarHealthIndicator, useValue: mockStellarIndicator },
        {
          provide: DocumentScanHealthIndicator,
          useValue: mockDocumentScanIndicator,
        },
        { provide: MemoryHealthIndicator, useValue: mockMemoryIndicator },
        { provide: DiskHealthIndicator, useValue: mockDiskIndicator },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    health = module.get<HealthCheckService>(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check()', () => {
    it('calls all health indicators when all services are healthy', async () => {
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockRabbitmqIndicator.isHealthy.mockResolvedValue({
        rabbitmq: { status: 'up' },
      });
      mockMemoryIndicator.checkHeap.mockResolvedValue({
        memory_heap: { status: 'up' },
      });
      mockMemoryIndicator.checkRSS.mockResolvedValue({
        memory_rss: { status: 'up' },
      });
      mockDiskIndicator.checkStorage.mockResolvedValue({
        disk: { status: 'up' },
      });

      await controller.check();

      expect(health.check).toHaveBeenCalled();
      expect(mockDbIndicator.pingCheck).toHaveBeenCalledWith('database');
      expect(mockRabbitmqIndicator.isHealthy).toHaveBeenCalledWith('rabbitmq');
      expect(mockMemoryIndicator.checkHeap).toHaveBeenCalled();
      expect(mockMemoryIndicator.checkRSS).toHaveBeenCalled();
      expect(mockDiskIndicator.checkStorage).toHaveBeenCalled();
    });

    it('reports unhealthy status when the RabbitMQ connection drops', async () => {
      // Simulate all other checks succeeding…
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockMemoryIndicator.checkHeap.mockResolvedValue({
        memory_heap: { status: 'up' },
      });
      mockMemoryIndicator.checkRSS.mockResolvedValue({
        memory_rss: { status: 'up' },
      });
      mockDiskIndicator.checkStorage.mockResolvedValue({
        disk: { status: 'up' },
      });

      // …but RabbitMQ broker is unreachable.
      const rabbitmqError = new HealthCheckError(
        'rabbitmq health check failed',
        { rabbitmq: { status: 'down', message: 'connect ECONNREFUSED' } },
      );
      mockRabbitmqIndicator.isHealthy.mockRejectedValue(rabbitmqError);

      // HealthCheckService normally catches the HealthCheckError and returns
      // HTTP 503. In unit tests we exercise the indicator invocation path
      // directly via our mock, which re-throws.
      await expect(controller.check()).rejects.toThrow(HealthCheckError);

      expect(mockRabbitmqIndicator.isHealthy).toHaveBeenCalledWith('rabbitmq');
    });
  });

  describe('checkLive()', () => {
    it('returns 200 without invoking any dependency indicators', async () => {
      const result = await controller.checkLive();

      expect(result).toEqual({ status: 'ok' });
      expect(health.check).not.toHaveBeenCalled();
      expect(mockDbIndicator.pingCheck).not.toHaveBeenCalled();
      expect(mockRedisIndicator.isHealthy).not.toHaveBeenCalled();
      expect(mockRabbitmqIndicator.isHealthy).not.toHaveBeenCalled();
    });
  });

  describe('checkReady()', () => {
    it('returns 200 when PostgreSQL, Redis and RabbitMQ are healthy', async () => {
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockRedisIndicator.isHealthy.mockResolvedValue({
        redis: { status: 'up' },
      });
      mockRabbitmqIndicator.isHealthy.mockResolvedValue({
        rabbitmq: { status: 'up' },
      });

      const result = await controller.checkReady();

      expect(health.check).toHaveBeenCalled();
      expect(mockDbIndicator.pingCheck).toHaveBeenCalledWith('database');
      expect(mockRedisIndicator.isHealthy).toHaveBeenCalledWith('redis');
      expect(mockRabbitmqIndicator.isHealthy).toHaveBeenCalledWith('rabbitmq');
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ database: { status: 'up' } }),
          expect.objectContaining({ redis: { status: 'up' } }),
          expect.objectContaining({ rabbitmq: { status: 'up' } }),
        ]),
      );
    });

    it('returns 503 when PostgreSQL is down', async () => {
      mockDbIndicator.pingCheck.mockRejectedValue(
        new HealthCheckError('database health check failed', {
          database: { status: 'down', message: 'connect ECONNREFUSED' },
        }),
      );
      mockRedisIndicator.isHealthy.mockResolvedValue({
        redis: { status: 'up' },
      });
      mockRabbitmqIndicator.isHealthy.mockResolvedValue({
        rabbitmq: { status: 'up' },
      });

      await expect(controller.checkReady()).rejects.toThrow(HealthCheckError);
    });

    it('returns 503 when Redis is down', async () => {
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockRedisIndicator.isHealthy.mockRejectedValue(
        new HealthCheckError('redis health check failed', {
          redis: { status: 'down', message: 'connect ECONNREFUSED' },
        }),
      );
      mockRabbitmqIndicator.isHealthy.mockResolvedValue({
        rabbitmq: { status: 'up' },
      });

      await expect(controller.checkReady()).rejects.toThrow(HealthCheckError);
    });

    it('returns 503 when RabbitMQ is down', async () => {
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockRedisIndicator.isHealthy.mockResolvedValue({
        redis: { status: 'up' },
      });
      mockRabbitmqIndicator.isHealthy.mockRejectedValue(
        new HealthCheckError('rabbitmq health check failed', {
          rabbitmq: { status: 'down', message: 'connect ECONNREFUSED' },
        }),
      );

      await expect(controller.checkReady()).rejects.toThrow(HealthCheckError);
    });
  });

  describe('checkDetail()', () => {
    it('surfaces ClamAV scan availability in degraded mode', async () => {
      mockDbIndicator.pingCheck.mockResolvedValue({
        database: { status: 'up' },
      });
      mockRabbitmqIndicator.isHealthy.mockResolvedValue({
        rabbitmq: { status: 'up' },
      });
      mockRedisIndicator.isHealthy.mockResolvedValue({
        redis: { status: 'up' },
      });
      mockStellarIndicator.isHealthy.mockResolvedValue({
        stellar: { status: 'up' },
      });
      mockDocumentScanIndicator.isHealthy.mockResolvedValue({
        documents: {
          status: 'up',
          scan_available: false,
          scan_enabled: false,
          mode: 'disabled',
        },
      });
      mockMemoryIndicator.checkHeap.mockResolvedValue({
        memory_heap: { status: 'up' },
      });
      mockMemoryIndicator.checkRSS.mockResolvedValue({
        memory_rss: { status: 'up' },
      });
      mockDiskIndicator.checkStorage.mockResolvedValue({
        disk: { status: 'up' },
      });

      const result = await controller.checkDetail();

      expect(mockDocumentScanIndicator.isHealthy).toHaveBeenCalledWith(
        'documents',
      );
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documents: expect.objectContaining({ scan_available: false }),
          }),
        ]),
      );
    });
  });
});
