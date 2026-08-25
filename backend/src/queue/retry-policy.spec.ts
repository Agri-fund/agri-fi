import {
  getExponentialBackoffDelayMs,
  calculateBackoffWithJitter,
  getDeliveryAttempt,
  isTransientQueueError,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_JITTER_MS,
} from './retry-policy';

describe('RetryPolicy - Exponential Backoff with Jitter', () => {
  describe('getExponentialBackoffDelayMs', () => {
    it('increases exponentially on subsequent attempt numbers', () => {
      const baseDelay = 1000;
      const delay1 = getExponentialBackoffDelayMs(1, baseDelay, 0);
      const delay2 = getExponentialBackoffDelayMs(2, baseDelay, 0);
      const delay3 = getExponentialBackoffDelayMs(3, baseDelay, 0);

      expect(delay1).toBe(1000); // 1000 * 2^0
      expect(delay2).toBe(2000); // 1000 * 2^1
      expect(delay3).toBe(4000); // 1000 * 2^2
    });

    it('adds random noise (jitter) to distribute request arrival times', () => {
      const baseDelay = 1000;
      const maxJitter = 500;

      // Mock randomFn returning 0.5
      const delayWithJitter = getExponentialBackoffDelayMs(
        2,
        baseDelay,
        maxJitter,
        () => 0.5,
      );

      expect(delayWithJitter).toBe(2250); // 2000 + floor(0.5 * 500)
    });

    it('ensures jitter noise stays within [0, maxJitterMs)', () => {
      const baseDelay = 1000;
      const maxJitter = 300;

      for (let i = 0; i < 20; i++) {
        const delay = getExponentialBackoffDelayMs(2, baseDelay, maxJitter);
        expect(delay).toBeGreaterThanOrEqual(2000);
        expect(delay).toBeLessThan(2300);
      }
    });
  });

  describe('calculateBackoffWithJitter', () => {
    it('implements base_delay * 2^attempt + random_jitter', () => {
      const baseDelay = 500;
      const maxJitter = 200;

      const delay0 = calculateBackoffWithJitter(0, baseDelay, maxJitter, () => 0.1);
      const delay1 = calculateBackoffWithJitter(1, baseDelay, maxJitter, () => 0.5);
      const delay2 = calculateBackoffWithJitter(2, baseDelay, maxJitter, () => 0.9);

      expect(delay0).toBe(520); // 500 * 2^0 + 20
      expect(delay1).toBe(1100); // 500 * 2^1 + 100
      expect(delay2).toBe(2180); // 500 * 2^2 + 180
    });

    it('distributes arrival times across multiple concurrent calls', () => {
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(calculateBackoffWithJitter(2, 1000, 500));
      }
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('getDeliveryAttempt', () => {
    it('returns 1 if x-death header is missing', () => {
      expect(getDeliveryAttempt({})).toBe(1);
    });

    it('calculates total deaths from x-death header array', () => {
      const msg = {
        properties: {
          headers: {
            'x-death': [{ count: 2 }, { count: 1 }],
          },
        },
      };
      expect(getDeliveryAttempt(msg)).toBe(4);
    });
  });

  describe('isTransientQueueError', () => {
    it('identifies transient errors correctly', () => {
      expect(isTransientQueueError(new Error('Stellar connection failed'))).toBe(true);
      expect(isTransientQueueError(new Error('Horizon node ETIMEDOUT'))).toBe(true);
      expect(isTransientQueueError(new Error('Fatal syntax error'))).toBe(false);
    });
  });
});
