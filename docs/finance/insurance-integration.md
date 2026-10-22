# Insurance Integration

The insurance API connects trade deals to configured agricultural insurers. It provides comparable quotes, policy issuance, signed event-driven claims, insurer decisions, and claim payouts. Insurance providers are external regulated counterparties; this integration does not itself underwrite risk or guarantee coverage.

## Provider setup

Configure `INSURANCE_PROVIDERS` as a JSON array in the backend secret store. Each provider uses the canonical REST contract below:

```json
[
  {
    "id": "provider-a",
    "name": "Provider A",
    "baseUrl": "https://insurance.example.com",
    "apiKey": "managed-secret",
    "webhookSecret": "managed-webhook-secret"
  }
]
```

Provider URLs must use HTTPS. The backend sends bearer-authenticated requests with a bounded timeout and `Idempotency-Key` on policy, claim, and payout creation. Provider adapters must implement:

- `POST /v1/quotes`: accepts deal commodity, quantity, location, delivery date, coverage type, requested amount, and indicative risk premium. Returns `quote_id`, `premium`, `coverage_amount`, `currency` (`USD`), `terms` (JSON object), and optional ISO `expires_at`.
- `POST /v1/policies`: accepts `quote_id`, `client_reference`, and `contract_hash`; returns `policy_id` and optional `policy_number`.
- `POST /v1/claims`: accepts policy/event references, loss amount, currency, and evidence; returns `claim_id`.
- `POST /v1/payouts`: accepts the approved amount, claim reference, currency, and the platform Stellar payout address as `destination`; returns `payout_id`.

An insurer with a different API should be implemented as a provider adapter that maps these canonical operations to its own API. Provider credentials and webhook secrets must be stored outside source control. `STELLAR_PLATFORM_SECRET` must be configured for policy anchoring. `INSURANCE_PAYOUT_ESCROW_SECRET` must be configured for the dedicated insurance payout escrow; its Stellar account must have a USDC trustline and sufficient USDC liquidity before payout processing is enabled.

## API

All routes are versioned under `/api/v1/insurance`.

- `POST /deals/:dealId/quotes` compares configured providers and returns a recommendation. Authenticated deal farmers, traders, and admins may request a comparison. `coverageType` is `crop_failure`, `shipment_damage`, or `price_fluctuation`; `coveragePercent` is optional and defaults to 100.
- `POST /quotes/:quoteId/issue` binds an unexpired quote. The issued contract digest is anchored to Stellar and the returned policy includes its anchor transaction. An anchor failure leaves the policy in `anchor_pending`; retry with `POST /policies/:policyId/anchor`.
- `POST /policies/:policyId/claims` submits a covered claim. Each event ID is idempotent per policy and claim amounts cannot exceed the policy coverage.
- `POST /events` accepts signed event-source notifications to automatically submit claims for active policies matching the event type. Configure `INSURANCE_EVENT_WEBHOOK_SECRET` and send `x-insurance-signature` as `sha256=<hex HMAC-SHA256>` over canonical JSON (object keys sorted recursively, no insignificant whitespace).
- `POST /providers/:providerId/webhook` accepts insurer decisions and payout confirmations. The same signature format is used, with the configured provider `webhookSecret`. Approved claims cause a payout request to the platform Stellar account. The backend releases funds to the deal farmer only after a signed `paid` confirmation with the matching payout ID and exact approved amount.
- `GET /analytics` is restricted to admin roles and reports policies, claim rate, paid claims, premiums, payouts, and payout ratio per provider.

Claim funds are not taken from investor deal escrow. The insurer funds a dedicated insurance payout escrow, and the backend releases only the approved claim amount to the farmer's registered Stellar wallet, recording the resulting transaction hash. When the farmer has no USDC trustline, the transfer creates a claimable balance. The insurer/provider agreement must ensure the escrow receives the confirmed payout before sending a signed `paid` callback.

## Pricing and recommendations

The local indicative premium uses the trade deal's stored risk score (50 when absent), coverage type, deal duration, commodity volatility factor, and requested coverage amount. The insurer's returned premium and terms remain authoritative. Comparisons and recommendations use the returned USD coverage-to-premium value; quotes with invalid coverage, unsupported currency, expired terms, or malformed responses are excluded.

## Operations and limits

Provider failures are isolated during comparison so available quotes can still be returned. If every configured provider is unavailable, the endpoint returns a service-unavailable response. Claims use stable idempotency keys for provider retries; signed events must use stable UUID event IDs. Analytics provide insurance usage/risk signals but do not establish that insurance causes a target deal-volume increase. The 25% deal-volume goal must be evaluated against a measured pre-launch baseline after providers are contracted and the workflow is adopted.
