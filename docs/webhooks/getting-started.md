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

## 5. Delivery, Retries & Dead Letter Queue

Every event becomes a durable delivery record (`webhook_deliveries`) that is sent immediately and retried by a worker that runs every minute.

- **Delivery timeout:** 5000 ms per HTTP request. The receiver must answer with a `2xx` status.
- **Headers:** `x-webhook-signature` (HMAC-SHA256 of the raw body), `x-webhook-event` (event name) and `x-webhook-delivery` (delivery id, use it to de-duplicate).
- **Retries:** up to 6 retries after the first attempt, at these delays after each failure:

| Failed attempt | Wait before next attempt |
|---|---|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 | 4 hours |
| 6 | 4 hours |

- **Dead letter queue (DLQ):** after the 7th failed attempt the delivery gets status `failed` and stops retrying. It stays queryable and can be replayed.
- **Rate limiting:** at most `WEBHOOK_RATE_LIMIT_PER_MIN` (default 60) sends per endpoint per minute and per backend instance. Excess deliveries are deferred by one minute and do not use up a retry.
- **Event filtering:** `events` takes dotted event names (`deal.funding_progress`) or `*`. An endpoint only receives events it subscribed to.

### Delivery status

| Status | Meaning |
|---|---|
| `pending` | Created, first attempt not yet made |
| `retrying` | At least one attempt failed, next attempt scheduled in `nextAttemptAt` |
| `delivered` | Receiver answered `2xx` |
| `failed` | Retries exhausted (in the DLQ) |

Each delivery keeps an `attempts` log with the attempt number, timestamp, HTTP status code, error message and duration.

### Delivery management API (admin)

All routes are under `/admin/webhooks` and need an admin JWT.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/webhooks/:id/deliveries?status=&limit=` | Delivery log of one endpoint, newest first |
| GET | `/admin/webhooks/:id/summary` | Counts per status (dashboard) |
| GET | `/admin/webhooks/dlq/deliveries` | Deliveries in the DLQ across endpoints |
| POST | `/admin/webhooks/deliveries/:deliveryId/replay` | Retry a `failed` delivery now. Resets the retry counter, keeps the attempt log |

Partner-facing access to these routes is not available yet because partner API keys are not tied to the subscriptions they create.

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
