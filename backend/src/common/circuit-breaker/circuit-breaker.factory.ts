import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Opossum = require('opossum');

type CircuitBreakerCtor = typeof Opossum;
const CircuitBreaker: CircuitBreakerCtor =
  // Handle both CJS `module.exports = CircuitBreaker` and ESM default interop
  ((Opossum as unknown as { default?: CircuitBreakerCtor }).default ??
    Opossum) as CircuitBreakerCtor;

export type CircuitBreakerAction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult>;

export interface CreateCircuitBreakerOptions {
  /** Per-call timeout in ms (default 10_000). */
  timeout?: number;
  /** Error % that trips the breaker once volumeThreshold is met (default 50). */
  errorThresholdPercentage?: number;
  /** Cool-off window before half-open (default 30_000). */
  resetTimeout?: number;
  /** Minimum rolling-window requests before the breaker can open (default 5). */
  volumeThreshold?: number;
  /**
   * Return true to ignore an error (do not count toward the failure threshold).
   * Useful for expected 404 / client validation responses.
   */
  errorFilter?: (error: unknown) => boolean;
}

export function isCircuitOpenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  if (
    message.includes('breaker is open') ||
    message.includes('breaker is half-open and in cooldown')
  ) {
    return true;
  }
  return (
    typeof CircuitBreaker.isOurError === 'function' &&
    CircuitBreaker.isOurError(error) &&
    message.includes('breaker')
  );
}

/**
 * Shared opossum factory for outbound HTTP / integration call sites.
 * Open circuits fail-fast; after `resetTimeout` the breaker enters half-open
 * and allows a probe request to restore traffic on success.
 */
@Injectable()
export class CircuitBreakerFactory implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerFactory.name);
  private readonly breakers = new Map<string, Opossum>();

  constructor(private readonly config: ConfigService) {}

  create<TArgs extends unknown[], TResult>(
    name: string,
    action: CircuitBreakerAction<TArgs, TResult>,
    options: CreateCircuitBreakerOptions = {},
  ): Opossum<[...TArgs], TResult> {
    const existing = this.breakers.get(name);
    if (existing) {
      return existing as Opossum<[...TArgs], TResult>;
    }

    const envPrefix = `CB_${this.toEnvKey(name)}`;
    const breakerOptions: Opossum.Options = {
      timeout: this.readNumber(
        `${envPrefix}_TIMEOUT_MS`,
        options.timeout ?? 10_000,
      ),
      errorThresholdPercentage: this.readNumber(
        `${envPrefix}_ERROR_THRESHOLD`,
        options.errorThresholdPercentage ?? 50,
      ),
      resetTimeout: this.readNumber(
        `${envPrefix}_RESET_MS`,
        options.resetTimeout ?? 30_000,
      ),
      volumeThreshold: this.readNumber(
        `${envPrefix}_VOLUME_THRESHOLD`,
        options.volumeThreshold ?? 5,
      ),
      name,
      errorFilter: options.errorFilter,
    };

    const breaker = new CircuitBreaker<[...TArgs], TResult>(
      action,
      breakerOptions,
    );

    breaker.on('open', () =>
      this.logger.warn(
        `Circuit breaker "${name}" OPEN — failing fast until cool-off`,
      ),
    );
    breaker.on('halfOpen', () =>
      this.logger.warn(
        `Circuit breaker "${name}" HALF-OPEN — probing recovery`,
      ),
    );
    breaker.on('close', () =>
      this.logger.log(`Circuit breaker "${name}" CLOSED — traffic restored`),
    );
    breaker.on('fallback', () =>
      this.logger.debug(`Circuit breaker "${name}" served fallback`),
    );

    this.breakers.set(name, breaker as Opossum);
    return breaker;
  }

  get(name: string): Opossum | undefined {
    return this.breakers.get(name);
  }

  /** Snapshot of registered breaker states (for health / tests). */
  getStates(): Record<
    string,
    {
      opened: boolean;
      halfOpen: boolean;
      closed: boolean;
      stats: Opossum.Stats;
    }
  > {
    const states: Record<
      string,
      {
        opened: boolean;
        halfOpen: boolean;
        closed: boolean;
        stats: Opossum.Stats;
      }
    > = {};

    for (const [name, breaker] of this.breakers.entries()) {
      states[name] = {
        opened: breaker.opened,
        halfOpen: breaker.halfOpen,
        closed: breaker.closed,
        stats: breaker.stats,
      };
    }

    return states;
  }

  /**
   * Execute through a named breaker, mapping open-circuit failures to
   * ServiceUnavailableException for Nest HTTP layers.
   */
  async fireOrUnavailable<TArgs extends unknown[], TResult>(
    breaker: Opossum<[...TArgs], TResult>,
    ...args: TArgs
  ): Promise<TResult> {
    try {
      return await breaker.fire(...args);
    } catch (error) {
      if (isCircuitOpenError(error)) {
        throw new ServiceUnavailableException(
          `Circuit breaker "${breaker.name}" is open — failing fast`,
        );
      }
      throw error;
    }
  }

  onModuleDestroy(): void {
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }
    this.breakers.clear();
  }

  private toEnvKey(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
  }

  private readNumber(key: string, defaultValue: number): number {
    const raw = this.config.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }
}
