import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Key-Based Throttler Guard for Public Partner APIs (Issue #1014).
 *
 * Extends NestJS ThrottlerGuard to bucket requests by API Key ID
 * rather than IP address. This prevents IP collisions across partner proxy/cloud
 * networks and guarantees dedicated rate limits per partner organization.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 1. If API key authenticated, track by API key unique ID
    if (req?.apiKey?.id) {
      return `apikey:${req.apiKey.id}`;
    }

    // 2. Fallback to API key prefix from headers if guard hasn't attached yet
    const xApiKey = req?.headers?.['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.startsWith('agfi_live_')) {
      return `apikey:${xApiKey.substring(0, 14)}`;
    }

    // 3. User JWT authenticated
    const userId = req?.user?.id ?? req?.user?.sub;
    if (userId) {
      return `user:${userId}`;
    }

    // 4. Default to client IP
    return super.getTracker(req);
  }
}
