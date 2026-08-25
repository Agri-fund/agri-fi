/**
 * cache-manager v5 Redis store adapter (#743)
 *
 * cache-manager v5 removed the legacy string-based store lookup (e.g.
 * `store: 'redis'`) and requires a store factory object that exposes a
 * `create()` method returning an object that matches the `Store` interface:
 *   { get, set, del, reset, mset, mget, mdel, keys, ttl }
 *
 * This module builds that factory on top of the `redis` v5 client that is
 * already a project dependency, so no additional npm package is needed.
 *
 * Usage in CacheModule.registerAsync:
 *   store: redisCacheStore,
 *   redisUrl: process.env.REDIS_URL,
 *   ttl: 30_000, // default TTL in milliseconds
 */

import { createClient, RedisClientType } from 'redis';

export interface RedisCacheStoreConfig {
  redisUrl?: string;
  ttl?: number; // default TTL in milliseconds
}

/**
 * Thin Store wrapper around a connected Redis client.
 */
class RedisCacheStore {
  private readonly defaultTtlMs: number;

  constructor(
    private readonly client: RedisClientType,
    config: RedisCacheStoreConfig,
  ) {
    this.defaultTtlMs = config.ttl ?? 30_000;
  }

  /** Convert milliseconds to seconds for Redis EX option. */
  private msToSec(ms: number): number {
    return Math.max(1, Math.ceil(ms / 1000));
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const ttlSec = this.msToSec(ttl ?? this.defaultTtlMs);
    await this.client.set(key, serialized, { EX: ttlSec });
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async reset(): Promise<void> {
    await this.client.flushDb();
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.client.keys(pattern ?? '*');
  }

  async ttl(key: string): Promise<number> {
    // Redis returns seconds; convert to milliseconds to match cache-manager v5
    const sec = await this.client.ttl(key);
    return sec * 1000;
  }

  async mset(pairs: Array<[string, unknown]>, ttl?: number): Promise<void> {
    const ttlSec = this.msToSec(ttl ?? this.defaultTtlMs);
    await Promise.all(
      pairs.map(([key, value]) =>
        this.client.set(key, JSON.stringify(value), { EX: ttlSec }),
      ),
    );
  }

  async mget(...keys: string[]): Promise<Array<unknown>> {
    const values = await this.client.mGet(keys);
    return values.map((v) => {
      if (v === null || v === undefined) return undefined;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    });
  }

  async mdel(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }
}

/**
 * cache-manager v5 store factory.
 *
 * CacheModule.registerAsync passes the module config as the argument to
 * `store.create()`.  We connect the Redis client here so the connection is
 * established once at module init time.
 */
export const redisCacheStore = {
  async create(config: RedisCacheStoreConfig): Promise<RedisCacheStore> {
    const url = config.redisUrl ?? process.env.REDIS_URL ?? '';
    const client = createClient({ url }) as RedisClientType;

    client.on('error', (err: Error) => {
      // Log but don't crash — the app should degrade gracefully if Redis is
      // temporarily unavailable; requests will hit the database instead.
      console.error('[RedisCacheStore] Redis client error:', err.message);
    });

    await client.connect();
    return new RedisCacheStore(client, config);
  },
};
