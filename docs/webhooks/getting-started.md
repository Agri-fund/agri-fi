# Webhooks & Partner Public API Getting-Started Guide

This guide describes how external partners can request API keys, configure permission scopes, register webhook endpoints, verify incoming webhook signatures (HMAC-SHA256), handle retry semantics, and test sample payload delivery.

---

## 1. Creating an API Key

API keys use the `agfi_live_*` prefix. They allow authenticating requests to public backend endpoints on behalf of your partner application.

### Requesting/Creating Keys via API

Pass your bearer token (JWT) to the API Key management endpoint:

```bash
curl -X POST https://api.agri-fi.example.com/auth/api-keys \
  -H "Authorization: Bearer <YOUR_USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Partner Integration Key",
    "scopes": ["read:deals", "write:investments", "webhook:manage"],
    "expiresInDays": 90
  }'
```

**Response:**
```json
{
  "id": "c7a8b9f0-1234-4567-89ab-cdef01234567",
  "label": "Partner Integration Key",
  "rawKey": "agfi_live_xK9mP2vL8nQ4rT7wY1zA3bC5dE6fG7hI",
  "prefix": "agfi_live_xK9m",
  "scopes": ["read:deals", "write:investments", "webhook:manage"],
  "createdAt": "2026-09-25T12:00:00.000Z",
  "expiresAt": "2026-12-24T12:00:00.000Z"
}
```

> [!IMPORTANT]
> Save the `rawKey` immediately! The raw key is hashed before storage and cannot be retrieved again.

---

## 2. Choosing Scopes

When creating a key, assign only the necessary permissions:

| Scope | Description |
|---|---|
| `read:deals` | Query open trade deals, milestones, and metadata |
| `write:investments` | Create or manage deal investments |
| `read:reports` | Access compliance reports and audit logs |
| `webhook:manage` | Register, update, and manage webhook subscriptions |

---

## 3. Registering Webhook URLs

Register an HTTP/HTTPS endpoint to receive real-time notifications for trade deal events (such as `deal.funding_progress`).

```bash
curl -X POST https://api.agri-fi.example.com/webhooks/subscriptions \
  -H "Authorization: Bearer <YOUR_USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhooks/agri-fi",
    "events": ["deal.funding_progress"],
    "secret": "your_shared_webhook_secret_32_bytes_min"
  }'
```

If `secret` is omitted, the platform generates a 32-byte hex string and returns it in the response.

---

## 4. HMAC Signature Verification

All webhook requests from Agri-Fi include the signature in the header:
`x-webhook-signature`

The signature is a lowercase hex digest computed using **HMAC-SHA256(rawRequestBody, secret)**.

### Node.js Verification Example

```typescript
import { createHmac, timingSafeEqual } from 'crypto';
import express from 'express';

const app = express();
// Note: Use raw body buffer for signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));

function verifyWebhookSignature(req: express.Request, secret: string): boolean {
  const signatureHeader = req.headers['x-webhook-signature'] as string;
  if (!signatureHeader) return false;

  const rawBody = (req as any).rawBody;
  if (!rawBody) return false;

  const expectedSignature = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const incomingBuf = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuf.length !== incomingBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, incomingBuf);
}

app.post('/webhooks/agri-fi', (req, res) => {
  const secret = process.env.WEBHOOK_SECRET || 'your_shared_webhook_secret_32_bytes_min';
  
  if (!verifyWebhookSignature(req, secret)) {
    return res.status(401).send('Invalid webhook signature');
  }

  const payload = req.body;
  console.log('Received valid webhook event:', payload.event);

  res.status(200).send({ received: true });
});
```

---

## 5. Retry Semantics & Back-off

Agri-Fi delivers webhooks with automatic retries for unacknowledged or failing endpoints:

- **Delivery Timeout:** 5000 ms per HTTP request.
- **Maximum Attempts:** 3 attempts.
- **Back-off Schedule:** Exponential back-off on delivery failure:
  - **Attempt 1:** Immediate initial attempt.
  - **Attempt 2:** Retry after 500 ms.
  - **Attempt 3:** Retry after 1000 ms.
- **Success Criteria:** Receiver must respond with HTTP `2xx` status within 5 seconds.

---

## 6. Sample Payloads

### Event: `deal.funding_progress`

```json
{
  "event": "deal.funding_progress",
  "timestamp": "2026-09-25T12:30:00.000Z",
  "data": {
    "dealId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "tokenSymbol": "COCOA1002",
    "commodity": "Cocoa Beans (Grade A)",
    "totalValue": 100000,
    "totalInvested": 75000,
    "milestone": 75,
    "actualPercentage": 75.00,
    "status": "published"
  }
}
```

---

## 7. Public API SDK & cURL Usage

### Public API Endpoint Authentication
Endpoints accepting public API keys expect the key in the request header:
`x-api-key: agfi_live_...`

### Query Open Deals with cURL
```bash
curl -X GET https://api.agri-fi.example.com/trade-deals \
  -H "x-api-key: agfi_live_xK9mP2vL8nQ4rT7wY1zA3bC5dE6fG7hI"
```

### Fetch Deal Details via Node.js Fetch SDK
```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.agri-fi.example.com',
  headers: {
    'x-api-key': 'agfi_live_xK9mP2vL8nQ4rT7wY1zA3bC5dE6fG7hI',
  },
});

async function getDealInfo(dealId: string) {
  const response = await client.get(`/trade-deals/${dealId}`);
  return response.data;
}
```
