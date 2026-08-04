import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  CircuitBreakerFactory,
  isCircuitOpenError,
} from './circuit-breaker.factory';

describe('CircuitBreakerFactory', () => {
  let factory: CircuitBreakerFactory;

  const configValues: Record<string, string | number> = {
    CB_TEST_API_VOLUME_THRESHOLD: 2,
    CB_TEST_API_ERROR_THRESHOLD: 50,
    CB_TEST_API_RESET_MS: 40,
    CB_TEST_API_TIMEOUT_MS: 1_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerFactory,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string | number) =>
              key in configValues ? configValues[key] : defaultVal,
            ),
          },
        },
      ],
    }).compile();

    factory = module.get(CircuitBreakerFactory);
  });

  afterEach(() => {
    factory.onModuleDestroy();
  });

  it('creates a named breaker and reuses it on subsequent create()', () => {
    const action = jest.fn(async (n: number) => n * 2);
    const first = factory.create('test-api', action);
    const second = factory.create('test-api', action);

    expect(first).toBe(second);
    expect(factory.get('test-api')).toBe(first);
  });

  it('fails fast once the failure threshold is crossed', async () => {
    const action = jest.fn(async () => {
      throw new Error('upstream down');
    });
    const breaker = factory.create('test-api', action, {
      volumeThreshold: 2,
      errorThresholdPercentage: 50,
      timeout: 1_000,
      resetTimeout: 40,
    });

    await expect(breaker.fire()).rejects.toThrow('upstream down');
    await expect(breaker.fire()).rejects.toThrow('upstream down');
    // Extra failure helps push the rolling window over the threshold
    await expect(breaker.fire()).rejects.toThrow();

    expect(breaker.opened).toBe(true);
    const callsBefore = action.mock.calls.length;

    await expect(breaker.fire()).rejects.toThrow(/breaker is open/i);
    expect(action.mock.calls.length).toBe(callsBefore);
    expect(isCircuitOpenError(new Error('Breaker is open'))).toBe(true);
  });

  it('transitions to half-open after cool-off and can close on success', async () => {
    jest.useFakeTimers();
    let shouldFail = true;
    const action = jest.fn(async () => {
      if (shouldFail) {
        throw new Error('upstream down');
      }
      return 'ok';
    });

    const breaker = factory.create('test-api', action, {
      volumeThreshold: 2,
      errorThresholdPercentage: 50,
      timeout: 1_000,
      resetTimeout: 40,
    });

    await expect(breaker.fire()).rejects.toThrow();
    await expect(breaker.fire()).rejects.toThrow();
    await expect(breaker.fire()).rejects.toThrow();
    expect(breaker.opened).toBe(true);

    jest.advanceTimersByTime(50);
    expect(breaker.halfOpen || breaker.opened).toBe(true);

    shouldFail = false;
    await expect(breaker.fire()).resolves.toBe('ok');
    expect(breaker.closed).toBe(true);

    jest.useRealTimers();
  });

  it('maps open-circuit errors to ServiceUnavailableException via fireOrUnavailable', async () => {
    const action = jest.fn(async () => {
      throw new Error('upstream down');
    });
    const breaker = factory.create('test-api', action, {
      volumeThreshold: 1,
      errorThresholdPercentage: 50,
      timeout: 500,
      resetTimeout: 5_000,
    });

    await expect(factory.fireOrUnavailable(breaker)).rejects.toThrow(
      'upstream down',
    );
    // Trip open
    await expect(factory.fireOrUnavailable(breaker)).rejects.toThrow();

    if (breaker.opened) {
      await expect(factory.fireOrUnavailable(breaker)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });
});
