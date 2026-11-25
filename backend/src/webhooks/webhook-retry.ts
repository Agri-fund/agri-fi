/** Delay before each retry: 1m, 5m, 15m, 1h, 4h; the last value repeats. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
];

/** Retries after the first attempt. After these, a delivery is dead-lettered. */
export const MAX_RETRIES = 6;

/**
 * Delay to wait after the Nth failed attempt (1-based) before retrying, or
 * null when the retries are exhausted and the delivery must be dead-lettered.
 */
export function nextRetryDelayMs(failedAttempts: number): number | null {
  if (failedAttempts < 1 || failedAttempts > MAX_RETRIES) return null;
  return RETRY_DELAYS_MS[Math.min(failedAttempts, RETRY_DELAYS_MS.length) - 1];
}
