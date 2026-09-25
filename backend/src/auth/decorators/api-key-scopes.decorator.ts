import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '../entities/api-key.entity';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';

/**
 * Decorator to require specific API key permission scopes on a controller method or class.
 *
 * Example:
 *   @RequireApiKeyScopes('read:deals')
 *   @Get()
 *   listDeals() { ... }
 */
export const RequireApiKeyScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);
