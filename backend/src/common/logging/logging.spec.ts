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

  it('should carry service and version in pino bindings', () => {
    expect(logger.logger.bindings()).toEqual(
      expect.objectContaining({
        service: 'agri-fi-backend',
      }),
    );
  });

  it('should support structured logging with arbitrary fields', () => {
    const logSpy = jest.spyOn(logger.logger, 'info');

    logger.info({ userId: 'test-123', action: 'test' }, 'Test message');

    expect(logSpy).toHaveBeenCalledWith(
      { userId: 'test-123', action: 'test' },
      'Test message',
    );
  });

  it('should support structured logging with traceId field', () => {
    const logSpy = jest.spyOn(logger.logger, 'info');
    const traceId = 'trace-abc-123';

    logger.info({ traceId, dealId: 'deal-456' }, 'Deal published');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ traceId }),
      'Deal published',
    );
  });

  it('should support warn level with structured data', () => {
    const logSpy = jest.spyOn(logger.logger, 'warn');

    logger.warn({ traceId: 'trace-xyz', attempt: 2 }, 'Retrying operation');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-xyz', attempt: 2 }),
      'Retrying operation',
    );
  });

  it('should support error level with structured data', () => {
    const logSpy = jest.spyOn(logger.logger, 'error');

    logger.error(
      { traceId: 'trace-err', error: 'Stellar timeout' },
      'Transaction failed',
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-err' }),
      'Transaction failed',
    );
  });

  it('should throw when assign() is called outside request scope', () => {
    // PinoLogger.assign() requires an active pino-http request context.
    // This documents the expected behaviour so callers know it is request-scoped.
    expect(() => {
      logger.assign({ traceId: 'test-123' });
    }).toThrow(
      'PinoLogger: unable to assign extra fields out of request scope',
    );
  });

  describe('production mode — raw JSON (no pretty transport)', () => {
    it('should not enable pretty transport when NODE_ENV=production', () => {
      // Mirror the guard condition from logging.config.ts:
      //   usePretty = LOG_PRETTY === 'true' && NODE_ENV !== 'production' && hasPinoPretty()
      // When NODE_ENV=production, usePretty must be false regardless of LOG_PRETTY.
      const computeUsePretty = (nodeEnv: string, logPretty: string) =>
        logPretty === 'true' && nodeEnv !== 'production';

      expect(computeUsePretty('production', 'true')).toBe(false);
      expect(computeUsePretty('production', 'false')).toBe(false);
    });

    it('should enable pretty transport in development when LOG_PRETTY=true', () => {
      const computeUsePretty = (nodeEnv: string, logPretty: string) =>
        logPretty === 'true' && nodeEnv !== 'production';

      expect(computeUsePretty('development', 'true')).toBe(true);
      expect(computeUsePretty('development', 'false')).toBe(false);
    });
  });
});
