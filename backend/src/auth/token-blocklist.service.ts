import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RedisConfig } from '../config/redis.config';
import { RedisClientType } from 'redis';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class TokenBlocklistService implements OnModuleInit, OnModuleDestroy {
  private redisClient: RedisClientType | null = null;

  constructor(
    private readonly redisConfig: RedisConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TokenBlocklistService.name);
  }

  async onModuleInit(): Promise<void> {
    this.redisClient = this.redisConfig.createClient();
    if (this.redisClient && !this.redisClient.isOpen) {
      try {
        await this.redisClient.connect();
      } catch (err: any) {
        this.logger.warn(
          { error: err.message },
          'Failed to connect Redis client for JWT blocklist',
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (!this.redisClient) return false;
    if (!this.redisClient.isOpen) {
      try {
        await this.redisClient.connect();
      } catch (err: any) {
        this.logger.warn(
          { error: err.message },
          'Failed to reconnect Redis for JWT blocklist',
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Adds an active JWT access token to the Redis blocklist for the given TTL.
   * Key format: blocklist:jwt:<token>
   */
  async blocklistToken(token: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return;

    try {
      const key = `blocklist:jwt:${token}`;
      await this.redisClient.setEx(key, Math.ceil(ttlSeconds), 'revoked');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to blocklist JWT token in Redis',
      );
    }
  }

  /**
   * Checks if a JWT token has been blocklisted in Redis.
   */
  async isBlocklisted(token: string): Promise<boolean> {
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return false;

    try {
      const key = `blocklist:jwt:${token}`;
      const val = await this.redisClient.get(key);
      return val === 'revoked';
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to check JWT token blocklist in Redis',
      );
      return false;
    }
  }

  /**
   * Marks a rotated-out refresh token jti as used, for the given TTL
   * (normally the token's own remaining lifetime). A repeat sighting of
   * the same jti means the refresh token was replayed after rotation.
   * Key format: blocklist:refresh:jti:<jti>
   */
  async markRefreshTokenRotated(
    jti: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (ttlSeconds <= 0) return;
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return;

    try {
      const key = `blocklist:refresh:jti:${jti}`;
      await this.redisClient.setEx(key, Math.ceil(ttlSeconds), 'rotated');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to record rotated refresh token jti in Redis',
      );
    }
  }

  /**
   * Checks whether a refresh token jti has already been rotated out (used).
   */
  async isRefreshTokenRotated(jti: string): Promise<boolean> {
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return false;

    try {
      const key = `blocklist:refresh:jti:${jti}`;
      const val = await this.redisClient.get(key);
      return val === 'rotated';
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to check rotated refresh token jti in Redis',
      );
      return false;
    }
  }

  /**
   * Revokes an entire refresh token family (rotation chain) for the given
   * TTL. Used when reuse of an already-rotated token is detected, so every
   * outstanding token descended from that family stops working.
   * Key format: blocklist:refresh:family:<familyId>
   */
  async revokeTokenFamily(familyId: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return;

    try {
      const key = `blocklist:refresh:family:${familyId}`;
      await this.redisClient.setEx(key, Math.ceil(ttlSeconds), 'revoked');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to revoke refresh token family in Redis',
      );
    }
  }

  /**
   * Checks whether a refresh token family has been revoked.
   */
  async isTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const connected = await this.ensureConnected();
    if (!connected || !this.redisClient) return false;

    try {
      const key = `blocklist:refresh:family:${familyId}`;
      const val = await this.redisClient.get(key);
      return val === 'revoked';
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to check refresh token family revocation in Redis',
      );
      return false;
    }
  }
}
