import {
  AgriFiClient,
  verifyWebhookSignature,
  computeWebhookSignature,
  constructWebhookEvent,
  WebhookSignatureError,
} from '../src';

describe('@agri-fi/sdk (Issue #1014)', () => {
  const apiKey = 'agfi_live_3f9a1234567890abcdef12345678';
  const secret = 'whsec_9f83a241b0c94628ef1a7c88b90e';

  it('initializes AgriFiClient with valid key and options', () => {
    const client = new AgriFiClient({
      apiKey,
      baseUrl: 'https://api-sandbox.agri-fi.io',
    });

    expect(client).toBeDefined();
    expect(client.deals).toBeDefined();
    expect(client.webhooks).toBeDefined();
  });

  it('throws an error if initialized without valid agfi_live_ key', () => {
    expect(() => new AgriFiClient({ apiKey: 'invalid_key' })).toThrow(
      'AgriFiClient requires a valid API key starting with "agfi_live_"',
    );
  });

  describe('Webhook HMAC verification', () => {
    const payload = JSON.stringify({
      id: 'evt_123',
      event: 'deal.funded',
      timestamp: '2026-09-25T17:00:00Z',
      data: { dealId: 'deal-uuid', amount: 50000 },
    });

    it('computes and verifies authentic HMAC signatures', () => {
      const signature = computeWebhookSignature(payload, secret);
      expect(signature).toHaveLength(64);

      const isValid = verifyWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it('rejects tampered webhook payloads', () => {
      const signature = computeWebhookSignature(payload, secret);
      const tampered = JSON.stringify({
        id: 'evt_123',
        event: 'deal.funded',
        timestamp: '2026-09-25T17:00:00Z',
        data: { dealId: 'deal-uuid', amount: 9999999 }, // Tampered
      });

      const isValid = verifyWebhookSignature(tampered, signature, secret);
      expect(isValid).toBe(false);
    });

    it('constructs and parses verified webhook events', () => {
      const signature = computeWebhookSignature(payload, secret);
      const event = constructWebhookEvent(payload, signature, secret);

      expect(event.id).toBe('evt_123');
      expect(event.event).toBe('deal.funded');
      expect((event.data as any).amount).toBe(50000);
    });

    it('throws WebhookSignatureError on invalid signature', () => {
      expect(() => {
        constructWebhookEvent(payload, 'bad_signature_1234', secret);
      }).toThrow(WebhookSignatureError);
    });
  });
});
