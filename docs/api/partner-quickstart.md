# Agri-Fi Partner API & TypeScript SDK Quickstart Guide (v1)

## Overview (Issue #1014)

Agri-Fi provides a versioned, machine-to-machine public API surface (`/v1/public/...`) for verified off-takers, financial institutions, and agricultural cooperatives.

Key capabilities include:
- **Marketplace Reads**: Query active agricultural investment campaigns, deal terms, and crop varieties.
- **Deal Detail**: Inspect milestone schedules, on-chain Soroban escrow addresses, and settlement terms.
- **Webhook Subscriptions**: Subscribe to lifecycle notifications (`deal.funded`, `milestone.completed`, `settlement.completed`).
- **Scoped API Keys**: Dedicated keys starting with `agfi_live_*` with least-privilege permission scopes.
- **Per-Key Rate Limiting**: Dedicated 120 requests/minute buckets tracked per partner key.
- **Official Client SDK**: `@agri-fi/sdk` for Node.js and TypeScript.

---

## 1. Authentication & Scopes

API requests authenticate using the `x-api-key` header (or `Authorization: Bearer <key>`):

```http
GET /v1/public/deals HTTP/1.1
Host: api.agri-fi.io
x-api-key: agfi_live_3f9a1234567890abcdef
```

### Available Permission Scopes
| Scope | Description |
|---|---|
| `read:deals` | Read access to marketplace campaigns, crop specs, and deal details |
| `write:investments` | Create investments or forward purchase commitments |
| `read:reports` | Read audited harvest reports and compliance documents |
| `webhook:manage` | Register, view, and delete webhook subscriptions |

---

## 2. Rate Limiting & Bucket Tracking

The Public API enforces rate limits keyed to each partner's API Key ID via `ApiKeyThrottlerGuard`:
- **Default Partner Rate Limit**: `120 requests per minute`
- **Response Headers**:
  - `X-RateLimit-Limit`: Maximum requests permitted per window (120)
  - `X-RateLimit-Remaining`: Remaining requests in current window
  - `X-RateLimit-Reset`: Timestamp when bucket refreshes

When exceeding the rate limit, the API returns HTTP status `429 Too Many Requests` with a `Retry-After: <seconds>` header.

---

## 3. Getting Started with the TypeScript SDK

### Installation
```bash
npm install @agri-fi/sdk
# or
pnpm add @agri-fi/sdk
```

### Initializing the Client
```typescript
import { AgriFiClient } from '@agri-fi/sdk';

const client = new AgriFiClient({
  apiKey: process.env.AGRI_FI_API_KEY!, // e.g. agfi_live_...
  baseUrl: 'https://api.agri-fi.io',     // Optional, defaults to production
  timeoutMs: 10000,                      // Optional timeout (10s)
});
```

### Listing Marketplace Deals
```typescript
const deals = await client.deals.list({
  commodity: 'Cocoa',
  status: 'open',
  limit: 20,
  offset: 0,
});

console.log(`Found ${deals.pagination.total} deals:`);
for (const deal of deals.data) {
  console.log(`- ${deal.title} (${deal.commodity}): $${deal.totalValue}`);
}
```

### Retrieving Deal Details & On-Chain Milestones
```typescript
const deal = await client.deals.get('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

console.log(`Escrow Contract: ${deal.onChainContractAddress}`);
console.log(`Expected ROI: ${deal.expectedRoi}%`);
deal.milestones?.forEach((m) => {
  console.log(`- Milestone: ${m.title} (${m.tranchePercent}% tranche)`);
});
```

### Subscribing to Webhooks
```typescript
const webhook = await client.webhooks.subscribe({
  url: 'https://api.partner.com/agri-fi/webhook',
  events: ['deal.funded', 'milestone.completed', 'settlement.completed'],
  secret: 'whsec_your_secret_signing_key_here',
  description: 'Production Agri-Fi Event Receiver',
});

console.log(`Created webhook subscription: ${webhook.id}`);
```

### Verifying Incoming Webhook HMAC Signatures
```typescript
import express from 'express';
import { constructWebhookEvent, WebhookSignatureError } from '@agri-fi/sdk';

const app = express();
const WEBHOOK_SECRET = process.env.AGRI_FI_WEBHOOK_SECRET!;

// Note: express.raw({ type: 'application/json' }) ensures raw buffer access
app.post('/agri-fi/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'] as string;

  try {
    const event = constructWebhookEvent(req.body, signature, WEBHOOK_SECRET);
    console.log(`Received authentic webhook event: ${event.event}`, event.data);

    if (event.event === 'milestone.completed') {
      // Handle milestone completion
    }

    res.status(200).send({ received: true });
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.error('Tampered or invalid signature:', err.message);
      return res.status(401).send({ error: 'Invalid signature' });
    }
    res.status(400).send({ error: 'Webhook processing error' });
  }
});
```

---

## 4. OpenAPI Specification Reference

The full OpenAPI schema is available at `/api/docs` or can be generated via:
```bash
npm run build:docs
```
Public endpoints are tagged under `Public v1 - Partners & Integrations`.
