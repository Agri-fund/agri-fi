import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { ApiKey, ApiKeyScope } from './entities/api-key.entity';

export interface GeneratedApiKeyResponse {
  id: string;
  label: string;
  rawKey: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
  expiresAt: Date | null;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {}

  public hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async createApiKey(
    ownerId: string,
    label: string,
    scopes: ApiKeyScope[],
    expiresInDays?: number,
  ): Promise<GeneratedApiKeyResponse> {
    const randomBytes = crypto.randomBytes(32).toString('base64url');
    const rawKey = `agfi_live_${randomBytes}`;
    const prefix = rawKey.substring(0, 14);
    const hashedKey = this.hashKey(rawKey);

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = this.apiKeyRepository.create({
      hashedKey,
      prefix,
      label,
      ownerId,
      scopes,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    });

    const saved = await this.apiKeyRepository.save(apiKey);

    return {
      id: saved.id,
      label: saved.label,
      rawKey,
      prefix: saved.prefix,
      scopes: saved.scopes,
      createdAt: saved.createdAt,
      expiresAt: saved.expiresAt,
    };
  }

  async validateKey(rawKey: string): Promise<ApiKey> {
    if (!rawKey || !rawKey.startsWith('agfi_live_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const hashedKey = this.hashKey(rawKey);
    const apiKey = await this.apiKeyRepository.findOne({
      where: {
        hashedKey,
        revokedAt: IsNull(),
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Update last used timestamp
    apiKey.lastUsedAt = new Date();
    await this.apiKeyRepository.save(apiKey);

    return apiKey;
  }

  async listKeys(ownerId: string): Promise<Omit<ApiKey, 'hashedKey'>[]> {
    return await this.apiKeyRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeKey(ownerId: string, keyId: string): Promise<void> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: keyId, ownerId },
    });

    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${keyId} not found`);
    }

    apiKey.revokedAt = new Date();
    await this.apiKeyRepository.save(apiKey);
  }
}
