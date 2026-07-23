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

export const PRICE_REDIS_CLIENT = 'PRICE_REDIS_CLIENT';
export const XLM_USDC_PRICE_CACHE_KEY = 'stellar:prices:xlm-usdc';

interface PriceSnapshot {
  rate: number;
  source: 'coingecko' | 'cache' | 'fallback';
  fetchedAt: string;
}

@Injectable()
export class PricesService implements OnModuleInit, OnModuleDestroy {
  private refreshTimer?: NodeJS.Timeout;
  private lastKnownRate: number | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(PRICE_REDIS_CLIENT)
    private readonly redisClient: RedisClientType | null,
  ) {
    this.logger.setContext(PricesService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.connectRedis();
    await this.refreshAndCachePrice('startup');

    const refreshIntervalMs = this.getNumericConfig(
      'XLM_USDC_PRICE_REFRESH_INTERVAL_MS',
      60_000,
    );

    this.refreshTimer = setInterval(() => {
      void this.refreshAndCachePrice('interval');
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

  async getXlmUsdcRate(): Promise<number> {
    const cached = await this.readCachedRate();
    if (cached !== null) {
      this.lastKnownRate = cached;
      return cached;
    }

    return this.refreshAndCachePrice('cache-miss');
  }

  async refreshAndCachePrice(reason: string): Promise<number> {
    try {
      const liveRate = await this.fetchLiveRate();
      this.lastKnownRate = liveRate;
      await this.writeCachedRate(liveRate);

      this.logger.info(
        { rate: liveRate, reason },
        'Refreshed XLM/USDC price feed',
      );

      return liveRate;
    } catch (error) {
      const fallbackRate =
        (await this.readCachedRate()) ??
        this.lastKnownRate ??
        this.getFallbackRate();

      this.logger.warn(
        {
          reason,
          error: this.formatError(error),
          fallbackRate,
        },
        'Using fallback XLM/USDC price feed',
      );

      return fallbackRate;
    }
  }

  private async fetchLiveRate(): Promise<number> {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        timeout: this.getNumericConfig('XLM_USDC_PRICE_TIMEOUT_MS', 5000),
        params: {
          ids: 'stellar-lumen,usd-coin',
          vs_currencies: 'usd',
        },
      },
    );

    const xlmUsd = response.data?.['stellar-lumen']?.usd;
    const usdcUsd = response.data?.['usd-coin']?.usd ?? 1;

    if (typeof xlmUsd !== 'number' || xlmUsd <= 0) {
      throw new Error('CoinGecko response did not include a valid XLM price');
    }

    if (typeof usdcUsd !== 'number' || usdcUsd <= 0) {
      throw new Error('CoinGecko response did not include a valid USDC price');
    }

    return xlmUsd / usdcUsd;
  }

  private async readCachedRate(): Promise<number | null> {
    if (!this.redisClient) {
      return null;
    }

    const rawValue = (await this.redisClient.get(XLM_USDC_PRICE_CACHE_KEY)) as
      | string
      | null;
    if (!rawValue) {
      return null;
    }

    try {
      const snapshot = JSON.parse(rawValue) as PriceSnapshot;
      return typeof snapshot.rate === 'number' && snapshot.rate > 0
        ? snapshot.rate
        : null;
    } catch {
      return null;
    }
  }

  private async writeCachedRate(rate: number): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    const snapshot: PriceSnapshot = {
      rate,
      source: 'coingecko',
      fetchedAt: new Date().toISOString(),
    };

    await this.redisClient.setEx(
      XLM_USDC_PRICE_CACHE_KEY,
      60,
      JSON.stringify(snapshot),
    );
  }

  private async connectRedis(): Promise<void> {
    if (!this.redisClient || this.redisClient.isOpen) {
      return;
    }

    await this.redisClient.connect();
  }

  private getFallbackRate(): number {
    return this.getNumericConfig('XLM_USDC_FALLBACK_RATE', 0.1);
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
