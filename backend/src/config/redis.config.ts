import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { createClient, RedisClientType } from 'redis';

/**
 * Configuration for secure Redis connections with TLS.
 * This service provides a factory method to create Redis clients
 * with TLS certificate authentication enabled.
 *
 * Auth-token resolution order:
 *  1. REDIS_SECRET_ARN  — fetch JSON from AWS Secrets Manager; reads
 *     `redis_auth_token` and (optionally) overrides REDIS_URL with `redis_url`.
 *  2. REDIS_AUTH_TOKEN  — plaintext token supplied via environment variable.
 *  3. No token          — unauthenticated connection (dev/test only).
 */
@Injectable()
export class RedisConfig {
  private readonly logger = new Logger(RedisConfig.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves the Redis AUTH token and (optionally) the connection URL from
   * AWS Secrets Manager when REDIS_SECRET_ARN is set.
   *
   * @returns Resolved { authToken, redisUrl } or null values when not set.
   */
  private async resolveSecret(
    baseUrl: string,
  ): Promise<{ authToken: string | undefined; redisUrl: string }> {
    const secretArn = this.configService.get<string>('REDIS_SECRET_ARN');

    if (secretArn) {
      try {
        const client = new SecretsManagerClient({});
        const response = await client.send(
          new GetSecretValueCommand({ SecretId: secretArn }),
        );
        const secret = JSON.parse(response.SecretString ?? '{}') as {
          redis_auth_token?: string;
          redis_url?: string;
        };

        return {
          authToken: secret.redis_auth_token,
          // Prefer the full URL from the secret (already contains the token
          // embedded) when available; fall back to the env-supplied base URL.
          redisUrl: secret.redis_url ?? baseUrl,
        };
      } catch (err) {
        this.logger.error(
          `Failed to fetch Redis secret from Secrets Manager (${secretArn}): ${(err as Error).message}`,
        );
        // Fall through to env-var auth token as a best-effort fallback.
      }
    }

    // Fall back to the plaintext env-var token.
    const authToken = this.configService.get<string>('REDIS_AUTH_TOKEN');
    return { authToken, redisUrl: baseUrl };
  }

  /**
   * Creates a Redis client with TLS configuration.
   * Uses rediss:// protocol when TLS is enabled.
   *
   * Resolution order for the AUTH token:
   *  1. REDIS_SECRET_ARN → AWS Secrets Manager
   *  2. REDIS_AUTH_TOKEN → plaintext env var
   *  3. No auth           → unauthenticated (dev only)
   *
   * @returns Redis client instance or null if REDIS_URL is not configured.
   */
  async createClient(): Promise<RedisClientType | null> {
    const baseUrl = this.configService.get<string>('REDIS_URL', '').trim();

    if (!baseUrl) {
      return null;
    }

    const { authToken, redisUrl } = await this.resolveSecret(baseUrl);

    const tlsEnabled = this.configService.get<boolean>(
      'REDIS_TLS_ENABLED',
      true,
    );
    const caCertPath = this.configService.get<string>('REDIS_CA_CERT_PATH');
    const clientCertPath = this.configService.get<string>(
      'REDIS_CLIENT_CERT_PATH',
    );
    const clientKeyPath = this.configService.get<string>(
      'REDIS_CLIENT_KEY_PATH',
    );

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
      socket:
        tlsEnabled && Object.keys(tlsConfig).length > 0
          ? { tls: tlsConfig as any }
          : tlsEnabled
            ? { tls: {} as any }
            : undefined,
    });
  }
}
