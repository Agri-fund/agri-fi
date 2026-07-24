export const DEFAULT_QUEUE_MAX_RETRIES = 3;

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

export function getExponentialBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
): number {
  const normalizedAttempt = Math.max(1, attempt);
  return Math.pow(2, normalizedAttempt - 1) * baseDelayMs;
}
