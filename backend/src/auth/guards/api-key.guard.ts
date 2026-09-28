import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from '../api-key.service';
import { ApiKeyScope } from '../entities/api-key.entity';
import { API_KEY_SCOPES_KEY } from '../decorators/api-key-scopes.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Extract raw API key from headers
    const rawKey = this.extractApiKey(req);
    if (!rawKey) {
      throw new UnauthorizedException('Missing API key. Provide via x-api-key header or Authorization: Bearer agfi_live_*');
    }

    // 2. Validate key existence, hash, and expiration
    const apiKey = await this.apiKeyService.validateKey(rawKey);

    // 3. Check scope requirements
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      API_KEY_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScopes && requiredScopes.length > 0) {
      const keyScopes = apiKey.scopes || [];
      const hasAllScopes = requiredScopes.every((scope) =>
        keyScopes.includes(scope),
      );

      if (!hasAllScopes) {
        const missing = requiredScopes.filter((s) => !keyScopes.includes(s));
        throw new ForbiddenException(
          `API key lacks required scope(s): ${missing.join(', ')}`,
        );
      }
    }

    // 4. Attach authenticated key and synthetic user to request
    req.apiKey = apiKey;
    req.user = {
      id: apiKey.ownerId,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
      isApiKeyAuth: true,
    };

    return true;
  }

  private extractApiKey(req: any): string | null {
    // 1. Primary: x-api-key header
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.startsWith('agfi_live_')) {
      return xApiKey;
    }

    // 2. Secondary: Bearer token format
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer agfi_live_')) {
      return authHeader.substring(7);
    }

    return null;
  }
}
