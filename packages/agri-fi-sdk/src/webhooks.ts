import * as crypto from 'crypto';
import { WebhookEvent } from './types';

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Computes the HMAC-SHA256 signature for a raw payload string and secret.
 */
export function computeWebhookSignature(
  rawPayload: string | Buffer,
  secret: string,
): string {
  const buf = Buffer.isBuffer(rawPayload)
    ? rawPayload
    : Buffer.from(rawPayload, 'utf8');
  return crypto.createHmac('sha256', secret).update(buf).digest('hex');
}

/**
 * Verifies that the incoming `x-webhook-signature` matches HMAC-SHA256(rawBody, secret)
 * using constant-time equality check to prevent timing attacks.
 */
export function verifyWebhookSignature(
  rawPayload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expected = computeWebhookSignature(rawPayload, secret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Verifies and parses an incoming webhook event.
 * Throws WebhookSignatureError if signature verification fails.
 */
export function constructWebhookEvent<T = Record<string, unknown>>(
  rawPayload: string | Buffer,
  signature: string,
  secret: string,
): WebhookEvent<T> {
  const isValid = verifyWebhookSignature(rawPayload, signature, secret);
  if (!isValid) {
    throw new WebhookSignatureError('Webhook signature verification failed');
  }

  const payloadStr = Buffer.isBuffer(rawPayload)
    ? rawPayload.toString('utf8')
    : rawPayload;

  try {
    return JSON.parse(payloadStr) as WebhookEvent<T>;
  } catch (err: any) {
    throw new WebhookSignatureError(`Invalid JSON in webhook payload: ${err.message}`);
  }
}
