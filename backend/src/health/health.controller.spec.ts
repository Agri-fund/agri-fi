import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheckError,
} from '@nestjs/terminus';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDbIndicator },
        {
          provide: RabbitmqHealthIndicator,
          useValue: mockRabbitmqIndicator,
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
});
