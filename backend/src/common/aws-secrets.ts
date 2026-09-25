/**
 * AWS Secrets Manager credential helper (#852).
 *
 * Reads database credentials and KMS key material from Secrets Manager.
 * Caches the secret for CACHE_TTL_MS (default 1 hour) and refreshes
 * automatically on expiry or on a forced refresh call.
 *
 * Usage:
 *   const creds = await secretsCache.getDbCredentials();
 *   // { host, port, username, password, database }
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const CACHE_TTL_MS = parseInt(
  process.env.SECRETS_CACHE_TTL_MS ?? '3600000',
  10,
);
const SECRET_ARN = process.env.DB_SECRET_ARN ?? '';

interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SecretsCache {
  private readonly client: SecretsManagerClient;
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor() {
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }

  private async fetchSecret(
    secretArn: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    const raw = response.SecretString ?? '{}';
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async getSecret<T>(secretArn: string, force = false): Promise<T> {
    const cached = this.cache.get(secretArn);
    if (!force && cached && Date.now() < cached.expiresAt) {
      return cached.value as T;
    }
    const value = await this.fetchSecret(secretArn);
    this.cache.set(secretArn, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value as T;
  }

  async getDbCredentials(force = false): Promise<DbCredentials> {
    return this.getSecret<DbCredentials>(SECRET_ARN, force);
  }

  /** Call after Secrets Manager rotation event to force immediate refresh. */
  async refreshDbCredentials(): Promise<DbCredentials> {
    return this.getDbCredentials(true);
  }

  invalidate(secretArn?: string): void {
    if (secretArn) {
      this.cache.delete(secretArn);
    } else {
      this.cache.clear();
    }
  }
}

export const secretsCache = new SecretsCache();
