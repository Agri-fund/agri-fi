export const DEFAULT_QUEUE_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_JITTER_MS = 500;

/**
 * Number of times this message has previously been dead-lettered/requeued,
 * derived from RabbitMQ's own `x-death` header array (one entry is appended
 * each time a message is nacked with requeue and redelivered).
 */
export function getDeliveryAttempt(msg: {
  properties?: { headers?: { 'x-death'?: Array<{ count?: number }> } };
}): number {
  const deaths = msg.properties?.headers?.['x-death'];
  if (!Array.isArray(deaths) || deaths.length === 0) return 1;
  return deaths.reduce((sum, d) => sum + (d.count ?? 0), 0) + 1;
}

export function isTransientQueueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');

  return [
    'stellar',
    'horizon',
    'timeout',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'connection',
    'database',
  ].some((needle) => message.includes(needle));
}

/**
 * Calculates exponential backoff with random jitter for queue retry operations.
 * Formula: base_delay * 2^(attempt - 1) + random_jitter (or base_delay * 2^attempt + random_jitter).
 *
 * @param attempt The current attempt count (1-indexed).
 * @param baseDelayMs Base delay in milliseconds (default 1000ms).
 * @param maxJitterMs Maximum random jitter in milliseconds to add (default 500ms).
 * @param randomFn Optional custom random generator (0..1) for deterministic testing.
 */
export function getExponentialBackoffDelayMs(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxJitterMs: number = 0,
  randomFn: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(1, attempt);
  const exponential = Math.pow(2, normalizedAttempt - 1) * baseDelayMs;
  const jitter = Math.floor(randomFn() * maxJitterMs);
  return exponential + jitter;
}

/**
 * Calculates exponential backoff retry delay using formula:
 * base_delay * 2^attempt + random_jitter
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxJitterMs: number = DEFAULT_MAX_JITTER_MS,
  randomFn: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(0, attempt);
  const exponential = baseDelayMs * Math.pow(2, normalizedAttempt);
  const jitter = Math.floor(randomFn() * maxJitterMs);
  return exponential + jitter;
}
