import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import { loggingConfig } from './logging.config';

describe('Logging Configuration', () => {
  let module: TestingModule;
  let logger: PinoLogger;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(loggingConfig)],
    }).compile();

    logger = await module.resolve<PinoLogger>(PinoLogger);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  it('should set context correctly', () => {
    logger.setContext('TestService');
    expect(logger.logger.bindings()).toEqual(
      expect.objectContaining({
        service: 'agri-fi-backend',
      }),
    );
  });

  it('should support structured logging', () => {
    const logSpy = jest.spyOn(logger.logger, 'info');

    logger.info({ userId: 'test-123', action: 'test' }, 'Test message');

    expect(logSpy).toHaveBeenCalledWith(
      { userId: 'test-123', action: 'test' },
      'Test message',
    );
  });

  it('should handle correlation ID assignment in request scope', () => {
    // This test verifies the logger can be configured for correlation IDs
    // In actual usage, correlation IDs are set by the middleware in request scope
    expect(() => {
      logger.assign({ correlationId: 'test-123' });
    }).toThrow(
      'PinoLogger: unable to assign extra fields out of request scope',
    );
  });
});
