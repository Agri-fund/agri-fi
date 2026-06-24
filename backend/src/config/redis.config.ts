import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/**
 * Configuration for secure Redis connections with TLS.
 * This service provides a factory method to create Redis clients
 * with TLS certificate authentication enabled.
 */
@Injectable()
export class RedisConfig {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a Redis client with TLS configuration.
   * Uses rediss:// protocol when TLS is enabled.
   *
   * @returns Redis client instance or null if REDIS_URL is not configured
   */
  createClient(): RedisClientType | null {
    const redisUrl = this.configService.get<string>('REDIS_URL', '').trim();

    if (!redisUrl) {
      return null;
    }

    const tlsEnabled = this.configService.get<boolean>('REDIS_TLS_ENABLED', true);
    const caCertPath = this.configService.get<string>('REDIS_CA_CERT_PATH');
    const clientCertPath = this.configService.get<string>('REDIS_CLIENT_CERT_PATH');
    const clientKeyPath = this.configService.get<string>('REDIS_CLIENT_KEY_PATH');

    // Build TLS configuration if enabled
    const tlsConfig: Record<string, string | boolean> = {};

    if (tlsEnabled) {
      if (caCertPath) {
        tlsConfig.ca = caCertPath;
      }
      if (clientCertPath) {
        tlsConfig.cert = clientCertPath;
      }
      if (clientKeyPath) {
        tlsConfig.key = clientKeyPath;
      }
    }

    // Use rediss:// protocol for TLS connections
    const secureUrl = tlsEnabled
      ? redisUrl.replace('redis://', 'rediss://')
      : redisUrl;

    return createClient({
      url: secureUrl,
      socket: tlsEnabled && Object.keys(tlsConfig).length > 0
        ? { tls: tlsConfig as any }
        : tlsEnabled
        ? { tls: {} as any }
        : undefined,
    });
  }
}
