export const DEFAULT_QUEUE_MAX_RETRIES = 3;

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
