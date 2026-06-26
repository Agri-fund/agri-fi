import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

const SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Guard that verifies HMAC-SHA256 signatures on incoming webhook requests.
 *
 * The caller must include an `x-webhook-signature` header containing the
 * lowercase hex digest of HMAC-SHA256(rawBody, WEBHOOK_SECRET).
 *
 * Requires the NestJS app to be bootstrapped with `{ rawBody: true }` so
 * that `req.rawBody` is populated before JSON parsing.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      throw new UnauthorizedException('Webhook secret is not configured.');
    }

    const incomingSignature = req.headers[SIGNATURE_HEADER];
    if (!incomingSignature || typeof incomingSignature !== 'string') {
      throw new UnauthorizedException(
        `Missing required header: ${SIGNATURE_HEADER}`,
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new UnauthorizedException('Request body is empty.');
    }

    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const incomingBuf = Buffer.from(incomingSignature, 'utf8');

    if (
      expectedBuf.length !== incomingBuf.length ||
      !timingSafeEqual(expectedBuf, incomingBuf)
    ) {
      throw new UnauthorizedException('Webhook signature mismatch.');
    }

    return true;
  }
}
