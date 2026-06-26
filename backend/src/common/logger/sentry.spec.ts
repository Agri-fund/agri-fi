import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';

jest.mock('@sentry/node');
const mockedSentry = Sentry as jest.Mocked<typeof Sentry>;

@Injectable()
class SentryIntegrationHandler {
  constructor() {
    this.initializeSentry();
  }

  private initializeSentry(): void {
    Sentry.init({
      dsn: process.env.SENTRY_DSN || '',
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
  }

  captureException(error: Error, context?: Record<string, any>): void {
    Sentry.captureException(error, {
      contexts: context ? { additional: context } : undefined,
    });
  }

  captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    Sentry.captureMessage(message, level);
  }
}

describe('SentryIntegrationHandler', () => {
  let handler: SentryIntegrationHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new SentryIntegrationHandler();
  });

  describe('captureException', () => {
    it('captures exceptions and invokes Sentry captureException method', () => {
      const testError = new Error('Test exception');
      handler.captureException(testError);

      expect(mockedSentry.captureException).toHaveBeenCalledWith(
        testError,
        expect.any(Object),
      );
    });

    it('includes context data when capturing exception', () => {
      const testError = new Error('Payment failed');
      const context = { userId: 'user-123', dealId: 'deal-456' };

      handler.captureException(testError, context);

      expect(mockedSentry.captureException).toHaveBeenCalledWith(
        testError,
        expect.objectContaining({
          contexts: expect.objectContaining({
            additional: context,
          }),
        }),
      );
    });

    it('handles uncaught exceptions without context', () => {
      const uncaughtError = new Error('Uncaught error');
      handler.captureException(uncaughtError);

      expect(mockedSentry.captureException).toHaveBeenCalledWith(
        uncaughtError,
        {
          contexts: undefined,
        },
      );
    });

    it('captures multiple exceptions in sequence', () => {
      const error1 = new Error('First error');
      const error2 = new Error('Second error');

      handler.captureException(error1);
      handler.captureException(error2);

      expect(mockedSentry.captureException).toHaveBeenCalledTimes(2);
      expect(mockedSentry.captureException).toHaveBeenNthCalledWith(1, error1, {
        contexts: undefined,
      });
      expect(mockedSentry.captureException).toHaveBeenNthCalledWith(2, error2, {
        contexts: undefined,
      });
    });
  });

  describe('captureMessage', () => {
    it('captures messages with default severity level', () => {
      const message = 'User logged in';
      handler.captureMessage(message);

      expect(mockedSentry.captureMessage).toHaveBeenCalledWith(message, 'info');
    });

    it('captures messages with custom severity level', () => {
      const message = 'Critical operation failed';
      handler.captureMessage(message, 'error');

      expect(mockedSentry.captureMessage).toHaveBeenCalledWith(
        message,
        'error',
      );
    });
  });
});
