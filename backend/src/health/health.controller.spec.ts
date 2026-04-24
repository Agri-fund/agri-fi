import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';

describe('HealthController', () => {
  let controller: HealthController;
  let health: HealthCheckService;

  const mockHealthCheckService = {
    check: jest.fn(),
  };
  const mockDbIndicator = {
    pingCheck: jest.fn(),
  };
  const mockMicroserviceIndicator = {
    pingCheck: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn().mockReturnValue('amqp://localhost'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDbIndicator },
        {
          provide: MicroserviceHealthIndicator,
          useValue: mockMicroserviceIndicator,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    health = module.get<HealthCheckService>(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call health.check with indicators', async () => {
    await controller.check();
    expect(health.check).toHaveBeenCalled();
    expect(mockDbIndicator.pingCheck).toHaveBeenCalledWith('database');
    expect(mockMicroserviceIndicator.pingCheck).toHaveBeenCalledWith(
      'rabbitmq',
      expect.any(Object),
    );
  });
});
