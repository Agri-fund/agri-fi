import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios from 'axios';
import { RedisClientType } from 'redis';

export const FX_REDIS_CLIENT = 'FX_REDIS_CLIENT';
export const FX_RATES_CACHE_KEY = 'fx:rates:usd';

// Supported currencies for multi-currency display
export const SUPPORTED_CURRENCIES = ['KES', 'NGN', 'GHS', 'TZS'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

interface FxRateSnapshot {
  rates: Record<SupportedCurrency, number>;
  source: 'exchangerate-api' | 'cache' | 'fallback';
  fetchedAt: string;
}

interface ExchangeRateApiResponse {
  base_code: string;
  conversion_rates: Record<string, number>;
}

@Injectable()
export class FxRateService implements OnModuleInit, OnModuleDestroy {
  private refreshTimer?: NodeJS.Timeout;
  private lastKnownRates: Record<SupportedCurrency, number> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(FX_REDIS_CLIENT)
    private readonly redisClient: RedisClientType | null,
  ) {
    this.logger.setContext(FxRateService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.connectRedis();
    await this.refreshAndCacheRates('startup');

    const refreshIntervalMs = this.getNumericConfig(
      'FX_RATE_REFRESH_INTERVAL_MS',
      3600_000, // 1 hour default
    );

    this.refreshTimer = setInterval(() => {
      void this.refreshAndCacheRates('interval');
    }, refreshIntervalMs);
    this.refreshTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  /**
   * Get exchange rates for supported currencies against USD
   * Returns rates from cache or fetches fresh if cache miss
   */
  async getExchangeRates(): Promise<Record<SupportedCurrency, number>> {
    const cached = await this.readCachedRates();
    if (cached !== null) {
      this.lastKnownRates = cached;
      return cached;
    }

    return this.refreshAndCacheRates('cache-miss');
  }

  /**
   * Convert USD amount to a specific currency
   * @param usdAmount Amount in USD
   * @param targetCurrency Target currency code (e.g., 'KES', 'NGN')
   */
  async convertUsdToLocal(
    usdAmount: number,
    targetCurrency: SupportedCurrency,
  ): Promise<number> {
    if (!SUPPORTED_CURRENCIES.includes(targetCurrency)) {
      throw new Error(
        `Unsupported currency: ${targetCurrency}. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }

    if (usdAmount < 0) {
      throw new Error('Amount must be non-negative');
    }

    const rates = await this.getExchangeRates();
    const rate = rates[targetCurrency];

    if (!rate || rate <= 0) {
      throw new Error(`Invalid exchange rate for ${targetCurrency}: ${rate}`);
    }

    return Number((usdAmount * rate).toFixed(2));
  }

  /**
   * Batch convert USD amount to multiple currencies
   */
  async convertUsdToMultipleCurrencies(
    usdAmount: number,
    currencies: SupportedCurrency[] = [...SUPPORTED_CURRENCIES],
  ): Promise<Record<SupportedCurrency, number>> {
    const result: Record<SupportedCurrency, number> = {} as any;

    for (const currency of currencies) {
      result[currency] = await this.convertUsdToLocal(usdAmount, currency);
    }

    return result;
  }

  private async refreshAndCacheRates(
    reason: string,
  ): Promise<Record<SupportedCurrency, number>> {
    try {
      const liveRates = await this.fetchLiveRates();
      this.lastKnownRates = liveRates;
      await this.writeCachedRates(liveRates);

      this.logger.info(
        { rates: liveRates, reason },
        'Refreshed FX exchange rates',
      );

      return liveRates;
    } catch (error) {
      const fallbackRates =
        (await this.readCachedRates()) ??
        this.lastKnownRates ??
        this.getFallbackRates();

      this.logger.warn(
        {
          reason,
          error: this.formatError(error),
          fallbackRates,
        },
        'Using fallback FX exchange rates',
      );

      return fallbackRates;
    }
  }

  private async fetchLiveRates(): Promise<Record<SupportedCurrency, number>> {
    const apiKey = this.config.get<string>('FX_API_KEY');
    const apiUrl = this.config.get<string>(
      'FX_API_URL',
      'https://v6.exchangerate-api.com/v6',
    );

    if (!apiKey) {
      throw new Error(
        'FX_API_KEY not configured. Cannot fetch live exchange rates.',
      );
    }

    const endpoint = `${apiUrl}/${apiKey}/latest/USD`;
    const response = await axios.get<ExchangeRateApiResponse>(endpoint, {
      timeout: this.getNumericConfig('FX_API_TIMEOUT_MS', 10_000),
    });

    const conversionRates = response.data?.conversion_rates;
    if (!conversionRates || typeof conversionRates !== 'object') {
      throw new Error('Invalid API response: missing conversion_rates');
    }

    const rates: Record<SupportedCurrency, number> = {} as any;
    for (const currency of SUPPORTED_CURRENCIES) {
      const rate = conversionRates[currency];
      if (typeof rate !== 'number' || rate <= 0) {
        throw new Error(
          `API did not return valid rate for ${currency}. Got: ${rate}`,
        );
      }
      rates[currency] = rate;
    }

    return rates;
  }

  private async readCachedRates(): Promise<Record<
    SupportedCurrency,
    number
  > | null> {
    if (!this.redisClient) {
      return null;
    }

    const rawValue = (await this.redisClient.get(FX_RATES_CACHE_KEY)) as
      string | null;
    if (!rawValue) {
      return null;
    }

    try {
      const snapshot = JSON.parse(rawValue) as FxRateSnapshot;
      const rates = snapshot.rates;

      // Validate all rates exist and are positive
      for (const currency of SUPPORTED_CURRENCIES) {
        if (typeof rates[currency] !== 'number' || rates[currency] <= 0) {
          return null;
        }
      }

      return rates;
    } catch {
      return null;
    }
  }

  private async writeCachedRates(
    rates: Record<SupportedCurrency, number>,
  ): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    const snapshot: FxRateSnapshot = {
      rates,
      source: 'exchangerate-api',
      fetchedAt: new Date().toISOString(),
    };

    const cacheTtlSeconds = this.getNumericConfig(
      'FX_CACHE_TTL_SECONDS',
      3600, // 1 hour default
    );

    await this.redisClient.setEx(
      FX_RATES_CACHE_KEY,
      cacheTtlSeconds,
      JSON.stringify(snapshot),
    );
  }

  private async connectRedis(): Promise<void> {
    if (!this.redisClient || this.redisClient.isOpen) {
      return;
    }

    await this.redisClient.connect();
  }

  private getFallbackRates(): Record<SupportedCurrency, number> {
    // Conservative fallback rates (approximate as of 2024)
    return {
      KES: Number(this.config.get('FX_FALLBACK_KES', 130.0)),
      NGN: Number(this.config.get('FX_FALLBACK_NGN', 1500.0)),
      GHS: Number(this.config.get('FX_FALLBACK_GHS', 13.5)),
      TZS: Number(this.config.get('FX_FALLBACK_TZS', 2650.0)),
    };
  }

  private getNumericConfig(key: string, defaultValue: number): number {
    const value = this.config.get<number | string>(key, defaultValue);
    const parsed = typeof value === 'string' ? Number(value) : value;

    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
