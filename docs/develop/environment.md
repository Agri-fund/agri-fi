# Environment Variable Reference

This document provides a consolidated reference for all environment variables used across the **Agri-Fi Backend** and **Frontend** services. It serves as the single source of truth for platform configuration, detailing data types, defaults, requirements across environments, descriptions, and secret sensitivity markers.

---

## Overview & Security Policy

1. **Placeholders Only in Version Control**: Never commit real API keys, private keys, or passwords. All `.env.example` and documentation files use sanitized placeholders (e.g. `your-secret-key-here`, `SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`).
2. **Secret Decoupling**: Variables storing credentials or private key material are designated with **Secret: Yes**. These must be supplied via Kubernetes Secrets, AWS Secrets Manager, or GitHub Actions Secrets.
3. **CI Coverage Enforcement**: The repository enforces that all variables read via `process.env` or `ConfigService` in `backend/src` must be documented in `backend/.env.example` with valid metadata. This is validated on CI via `npm run check:env`.

---

## Backend Environment Variables

The backend is built with NestJS and loads configuration from `.env` files locally, or injected environment variables and AWS Secrets Manager in cloud environments.

### 1. Database & Persistence

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `DATABASE_HOST` | `string` | `localhost` | **Yes** | Primary PostgreSQL database host address. | No |
| `DATABASE_PORT` | `number` | `5432` | No | PostgreSQL database listening port. | No |
| `DATABASE_USER` | `string` | `postgres` | **Yes** | Database username for application authentication. | No |
| `DATABASE_PASSWORD` | `string` | — | **Yes** | Password for the database user. | **Yes** |
| `DATABASE_NAME` | `string` | `agric_onchain` | **Yes** | Primary PostgreSQL database name. | No |
| `DATABASE_URL` | `string` | — | No | Full connection URL format: `postgres://user:pass@host:port/dbname`. When provided, overrides host/port/user/pass. | **Yes** |
| `DATABASE_REPLICA_HOST` | `string` | `localhost` | No | Host address of read-only replica used by TypeORM for `SELECT` queries. Falls back to `DATABASE_HOST`. | No |
| `DATABASE_REPLICA_URL` | `string` | — | No | Full connection URL for the read-only replica. | **Yes** |
| `DATABASE_POOL_MIN` | `number` | `5` (prod) / `2` (dev) | No | Minimum warm connections maintained in the TypeORM connection pool. | No |
| `DATABASE_POOL_MAX` | `number` | `50` (prod) / `10` (dev) | No | Maximum concurrent open connections in the pool. | No |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `number` | `30000` | No | Milliseconds an idle connection remains before pool release. | No |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `number` | `5000` | No | Milliseconds to wait for a connection before throwing a timeout. | No |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `number` | `30000` | No | Hard statement timeout cap (ms) preventing slow query pool starvation. | No |
| `DB_SECRET_ID` | `string` | `agri-fi/db-credentials` | No | AWS Secrets Manager secret name/ID for auto-rotated database credentials. | No |
| `DB_SECRET_ARN` | `string` | — | No | Full ARN of the AWS Secrets Manager DB credentials secret. | No |

### 2. Authentication & JWT

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `JWT_SECRET` | `string` | — | **Yes** | Cryptographic key (min 32 chars) for signing and verifying JWT access tokens. | **Yes** |
| `JWT_EXPIRES_IN` | `string` | `7d` | No | Expiration duration for access tokens (e.g. `15m`, `7d`). | No |
| `JWT_ACCESS_EXPIRES_IN` | `string` | `15m` | No | Access token expiration duration for short-lived session schemes. | No |
| `JWT_REFRESH_EXPIRES_IN` | `string` | `7d` | No | Refresh token validity window. | No |
| `APP_SECRET` | `string` | — | No | Internal application HMAC secret used for signature tokens. | **Yes** |
| `GOOGLE_CLIENT_ID` | `string` | — | No | Google OAuth 2.0 Client ID for investor single sign-on. | No |
| `GOOGLE_CLIENT_SECRET` | `string` | — | No | Google OAuth 2.0 Client Secret. | **Yes** |
| `GOOGLE_CALLBACK_URL` | `string` | `http://localhost:3001/v1/auth/google/callback` | No | Authorized redirect URI for Google OAuth callback. | No |
| `FRONTEND_URL` | `string` | `http://localhost:3000/en` | No | Frontend web app URL for post-authentication redirects. | No |
| `APP_BASE_URL` | `string` | `http://localhost:3001` | No | Public-facing base URL of the backend REST API. | No |

### 3. Stellar Blockchain & Escrow

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `STELLAR_NETWORK` | `string` | `testnet` | **Yes** | Target Stellar network: `testnet` or `mainnet`. | No |
| `STELLAR_HORIZON_URL` | `string` | `https://horizon-testnet.stellar.org` | No | Primary Stellar Horizon node endpoint. | No |
| `STELLAR_HORIZON_URLS` | `string` | Primary URL | No | Comma-separated list of Horizon node URLs used for automatic failover. | No |
| `STELLAR_PLATFORM_SECRET` | `string` | — | **Yes** | Base32 `S...` secret key of the Agri-Fi platform master escrow signer. | **Yes** |
| `STELLAR_PLATFORM_WALLET` | `string` | — | No | Public address `G...` of the platform wallet account. | No |
| `STELLAR_PLATFORM_PUBLIC` | `string` | — | No | Alias for `STELLAR_PLATFORM_WALLET`. | No |
| `STELLAR_MULTISIG_SIGNER_1_SECRET` | `string` | — | No | Secret key of additional signer 1 for 2-of-3 escrow multi-sig security. | **Yes** |
| `STELLAR_MULTISIG_SIGNER_2_SECRET` | `string` | — | No | Secret key of additional signer 2 for 2-of-3 escrow multi-sig security. | **Yes** |
| `STELLAR_MONITOR_BALANCE_THRESHOLD` | `number` | `50` | No | Minimum XLM platform account balance before firing a low-balance alert. | No |
| `STELLAR_MAX_FEE` | `number` | `10000` | No | Maximum transaction base fee allowed (in stroops) to avoid fee surges. | No |
| `TOKEN_PRICE_USD` | `number` | `100` | No | Valuation per fractional produce token (default 1 Trade_Token = $100). | No |
| `PLATFORM_FEE_PERCENT` | `number` | `2` | No | Platform fee percentage retained upon milestone settlement (default 2%). | No |

### 4. Soroban Smart Contracts

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `SOROBAN_RPC_URL` | `string` | `https://soroban-testnet.stellar.org` | No | JSON-RPC endpoint for Soroban smart contract invocations. | No |
| `SOROBAN_FACTORY_CONTRACT_ID` | `string` | — | No | Deployed contract ID (`C...`) of the deal project factory. | No |
| `SOROBAN_SETTLEMENT_CONTRACT_ID` | `string` | — | No | Deployed contract ID (`C...`) of the escrow settlement contract. | No |
| `SOROBAN_DISTRIBUTOR_CONTRACT_ID`| `string` | — | No | Deployed contract ID (`C...`) of the yield/revenue distributor contract. | No |
| `PROJECT_FACTORY_CONTRACT` | `string` | — | No | Alias for `SOROBAN_FACTORY_CONTRACT_ID`. | No |
| `MARKETPLACE_SETTLEMENT_CONTRACT`| `string` | — | No | Alias for `SOROBAN_SETTLEMENT_CONTRACT_ID`. | No |
| `REVENUE_DISTRIBUTOR_CONTRACT` | `string` | — | No | Alias for `SOROBAN_DISTRIBUTOR_CONTRACT_ID`. | No |
| `FARM_CAMPAIGN_CONTRACT` | `string` | — | No | Contract address for specific farm crowdfunding campaigns. | No |
| `SOROBAN_EXTEND_TO_LEDGERS` | `number` | `535680` | No | Target ledger sequence count when extending contract storage TTL (~30d). | No |
| `SOROBAN_WARN_TTL_LEDGERS` | `number` | `86400` | No | Warning threshold for state expiration alerting (~5 days). | No |
| `USDC_ASSET_CODE` | `string` | `USDC` | No | Asset code of the collateral token on Stellar. | No |
| `USDC_ISSUER` | `string` | `GBBD47...` | No | Public key of the testnet/mainnet USDC asset issuer account. | No |

### 5. Encryption & Key Management (KMS)

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `ENCRYPTION_KEY` | `string` | — | **Yes** | 64-character hex string (32-byte key) for AES-256 column encryption at rest. | **Yes** |
| `QUEUE_ENCRYPTION_KEY` | `string` | Falls back to `ENCRYPTION_KEY` | No | 64-char hex key for RabbitMQ payload payload encryption. | **Yes** |
| `KMS_KEY_ID` | `string` | — | No | AWS KMS Key ARN or Alias for envelope encryption of issuer secrets. | No |
| `SECRETS_CACHE_TTL_MS` | `number` | `300000` | No | TTL (ms) for caching secrets in memory before re-fetching from AWS. | No |

### 6. RabbitMQ Asynchronous Queue

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `RABBITMQ_URL` | `string` | `amqp://guest:guest@localhost:5672` | No | AMQP broker connection URL. | **Yes** |
| `RABBITMQ_USER` | `string` | `guest` | No | Broker authentication username. | No |
| `RABBITMQ_PASSWORD` | `string` | `guest` | No | Broker authentication password. | **Yes** |
| `RABBITMQ_VHOST` | `string` | `/` | No | Virtual host name in RabbitMQ. | No |
| `RABBITMQ_PREFETCH_COUNT` | `number` | `10` | No | Pre-fetch count per consumer pod to balance load under spikes. | No |
| `QUEUE_ALERT_THRESHOLD` | `number` | `100` | No | Unacknowledged messages backlog threshold for dead-letter alerts. | No |

### 7. Redis Distributed Caching & TLS

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `REDIS_URL` | `string` | `redis://localhost:6379` | No | Redis connection URL. Leave unset for in-memory caching fallback. | **Yes** |
| `REDIS_TLS_ENABLED` | `boolean` | `false` | No | Enables TLS (`rediss://`) for secure Redis communication. | No |
| `REDIS_AUTH_TOKEN` | `string` | — | No | Plaintext authentication token for Redis instance. | **Yes** |
| `REDIS_SECRET_ARN` | `string` | — | No | AWS Secrets Manager ARN containing Redis auth token JSON. | No |
| `REDIS_CA_CERT_PATH` | `string` | — | No | Path to custom CA certificate for TLS verification. | No |
| `REDIS_CLIENT_CERT_PATH`| `string` | — | No | Path to client TLS certificate for mTLS authentication. | No |
| `REDIS_CLIENT_KEY_PATH` | `string` | — | No | Path to client private key for mTLS authentication. | No |

### 8. Storage: IPFS & AWS S3

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `IPFS_GATEWAY` | `string` | `https://api.web3.storage` | No | Primary IPFS endpoint for uploading and pinning documents. | No |
| `IPFS_TOKEN` | `string` | — | No | API access token for web3.storage pinning services. | **Yes** |
| `IPFS_GATEWAYS` | `string` | `cloudflare-ipfs.com,ipfs.io,...` | No | Comma-separated fallback gateways probed for availability. | No |
| `AWS_REGION` | `string` | `us-east-1` | No | AWS region for S3 buckets and KMS operations. | No |
| `AWS_ACCESS_KEY_ID` | `string` | — | No | AWS IAM access key ID. | **Yes** |
| `AWS_SECRET_ACCESS_KEY` | `string` | — | No | AWS IAM secret access key. | **Yes** |
| `AWS_S3_BUCKET` | `string` | — | No | S3 bucket name for documents, receipts, and KYC file storage. | No |
| `USE_STORAGE_MOCK` | `boolean` | `false` | No | When true, replaces cloud S3 storage with local mock storage. | No |

### 9. Server, Networking & Security

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `PORT` | `number` | `3001` | No | TCP port the NestJS server listens on. | No |
| `ALLOWED_ORIGINS` | `string` | `http://localhost:3000,http://localhost:3001` | No | Comma-separated list of origins allowed by CORS. | No |
| `ALLOWED_HOSTS` | `string` | `localhost` | No | DNS rebinding protection whitelist of permitted HTTP `Host` header values. | No |
| `ALLOWED_COUNTRIES` | `string` | `US,GB,GH,KE,NG,TZ` | No | Permitted ISO alpha-2 country codes for trade deals and KYC. | No |
| `TRUST_PROXY` | `boolean` | `false` | No | Enables Express trust proxy mode when running behind reverse proxy/ingress. | No |
| `RATE_LIMIT_GLOBAL` | `number` | `100` | No | Default global request rate limit cap per IP. | No |
| `RATE_LIMIT_TTL` | `number` | `60000` | No | Window duration in milliseconds for rate limiter (default: 60s). | No |
| `METRICS_ALLOWED_IPS` | `string` | `127.0.0.1,::1` | No | Comma-separated IP whitelist allowed to scrape `/metrics`. | No |
| `SWAGGER_USER` | `string` | `admin` | No | HTTP Basic Auth username for `/api/docs`. | No |
| `SWAGGER_PASS` | `string` | — | **Prod-only** | HTTP Basic Auth password for Swagger API documentation. | **Yes** |

### 10. Antivirus (ClamAV)

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `CLAMAV_HOST` | `string` | `clamav` | No | Hostname of the ClamAV scanning daemon. | No |
| `CLAMAV_PORT` | `number` | `3310` | No | TCP port of the ClamAV daemon. | No |
| `CLAM_SCAN_ENABLED` | `boolean` | `true` (prod) | No | Enforces file virus scanning. Required true in production. | No |

### 11. Multi-Currency / FX Rates

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `FX_API_KEY` | `string` | — | No | API key for ExchangeRate-API. | **Yes** |
| `FX_API_URL` | `string` | `https://v6.exchangerate-api.com/v6` | No | FX API endpoint origin. | No |
| `FX_API_TIMEOUT_MS` | `number` | `10000` | No | Timeout in ms for fetching live FX exchange rates. | No |
| `FX_CACHE_TTL_SECONDS` | `number` | `3600` | No | Cache TTL (seconds) for exchange rates. | No |
| `FX_FALLBACK_KES` | `number` | `130.0` | No | Fallback exchange rate for Kenyan Shilling (1 USD = KES). | No |
| `FX_FALLBACK_NGN` | `number` | `1500.0` | No | Fallback exchange rate for Nigerian Naira (1 USD = NGN). | No |
| `FX_FALLBACK_GHS` | `number` | `13.5` | No | Fallback exchange rate for Ghanaian Cedi (1 USD = GHS). | No |
| `FX_FALLBACK_TZS` | `number` | `2650.0` | No | Fallback exchange rate for Tanzanian Shilling (1 USD = TZS). | No |

### 12. KYC & OFAC Sanctions Screening

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `KYC_AUTO_APPROVE` | `boolean` | `false` | No | Dev-only flag to auto-approve non-corporate KYC submissions. | No |
| `OFAC_API_KEY` | `string` | — | No | API key for OFAC SDN sanctions screening service. | **Yes** |
| `OFAC_API_URL` | `string` | — | No | Sanctions screening API endpoint. | No |
| `OFAC_RISK_THRESHOLD` | `number` | `75` | No | Score threshold (0-100) above which KYC submissions are flagged. | No |

### 13. Notifications, Email & Alerting

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `NOTIFICATIONS_ENABLED` | `boolean` | `false` | No | Master switch for dispatching emails and push notifications. | No |
| `SMTP_HOST` | `string` | `smtp.mailtrap.io` | No | SMTP relay server hostname. | No |
| `SMTP_PORT` | `number` | `2525` | No | SMTP relay server port. | No |
| `SMTP_USER` | `string` | — | No | SMTP authentication username. | No |
| `SMTP_PASS` | `string` | — | No | SMTP authentication password. | **Yes** |
| `EMAIL_FROM` | `string` | `noreply@agric-onchain.com` | No | Origin email address for outgoing system messages. | No |
| `EMAIL_TEMPLATES_DIR` | `string` | `templates/email` | No | Directory path containing localized HTML email templates. | No |
| `SENDGRID_API_KEY` | `string` | — | No | SendGrid REST API key (alternative to SMTP relay). | **Yes** |
| `SENDGRID_FROM_EMAIL` | `string` | — | No | Verified sender address configured in SendGrid. | No |
| `SENDGRID_SANDBOX_MODE` | `boolean` | `false` | No | SendGrid sandbox testing mode. | No |
| `ALERT_WEBHOOK_URL` | `string` | — | No | Generic webhook URL for system alert notifications. | **Yes** |
| `SLACK_WEBHOOK_URL` | `string` | — | No | Incoming webhook URL for operational notifications on Slack. | **Yes** |
| `DISCORD_WEBHOOK_URL` | `string` | — | No | Webhook URL for CI/CD failure alerts on Discord. | **Yes** |
| `ADMIN_ALERT_EMAIL` | `string` | — | No | Administrator email address for critical security events. | No |
| `OPS_ALERT_EMAIL` | `string` | — | No | Operations team mailing list for system warnings. | No |

### 14. SEP-24 & SEP-38 Fiat On/Off-Ramp

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `SEP24_INTERACTIVE_BASE_URL` | `string` | `http://localhost:3000/sep24/interactive` | No | Base URL for interactive deposit and withdrawal modals. | No |
| `SEP24_FEE_PERCENT` | `number` | `1` | No | Percentage fee deducted for SEP-24 fiat ramp transfers. | No |
| `SEP24_FEE_FIXED` | `number` | `0` | No | Fixed fee charged per deposit/withdrawal in fiat units. | No |
| `SEP24_MIN_AMOUNT` | `number` | `10` | No | Minimum transfer amount allowed via SEP-24. | No |
| `SEP24_MAX_AMOUNT` | `number` | `100000` | No | Maximum transfer limit per transaction. | No |
| `WEBHOOK_SECRET` | `string` | — | No | Shared secret for HMAC-SHA256 signature verification on callbacks. | **Yes** |
| `SEP38_FEE_BPS` | `number` | `50` | No | SEP-38 quote fee in basis points (50 bps = 0.5%). | No |
| `SEP38_XLM_USDC_RATE` | `number` | `0.12` | No | Fallback pricing rate for XLM/USDC conversions. | No |
| `TRUSTED_AUTHORITY_KEYS` | `string` | — | No | Comma-separated armored PGP public keys of trusted document authorities. | No |

### 15. Anti-Abuse, Threat Defense & Sensors

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `HCAPTCHA_SECRET_KEY` | `string` | — | No | Secret key for verifying hCaptcha challenge tokens. | **Yes** |
| `HCAPTCHA_SITEKEY` | `string` | — | No | Public sitekey rendered on the frontend hCaptcha widget. | No |
| `SECURITY_BAD_IP_RANGES` | `string` | — | No | Comma-separated hostile IPv4 CIDR blocks blocked on sight. | No |
| `SECURITY_OPS_EMAIL` | `string` | — | No | Recipient mailbox for credential-stuffing threat alerts. | No |
| `SECURITY_DISTINCT_IPS_THRESHOLD` | `number` | `5` | No | Rapid IP change count triggering suspicious login alarms. | No |
| `SECURITY_GEO_COUNTRIES_THRESHOLD` | `number` | `3` | No | Multiple country hops within short duration triggering lockout. | No |
| `SECURITY_SUBNET_FAIL_THRESHOLD` | `number` | `10` | No | Failed attempts from a /24 subnet before blocking the range. | No |
| `SENSOR_TEMP_MIN` / `SENSOR_TEMP_MAX` | `number` | `-5` / `45` | No | Permitted temperature range (°C) for produce shipment monitoring. | No |
| `SENSOR_HUMIDITY_MIN` / `SENSOR_HUMIDITY_MAX` | `number` | `20` / `85` | No | Permitted relative humidity range (%) for cold-chain storage. | No |
| `SENSOR_CO2_MIN` / `SENSOR_CO2_MAX` | `number` | `350` / `2500`| No | Acceptable CO2 concentration (ppm) before alerting fermentation. | No |
| `SENSOR_VIBRATION_MIN` / `SENSOR_VIBRATION_MAX` | `number` | `0` / `10` | No | Shock/vibration acceleration limits (g) for cargo integrity. | No |

---

## Frontend Environment Variables

Frontend variables prefixed with `NEXT_PUBLIC_` are inlined into client-side JavaScript bundles by Next.js during build time. Variables without this prefix remain available only in the Next.js server runtime.

| Variable | Type | Default | Required | Description | Secret? |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `string` | `http://localhost:3001` | **Yes** | Base URL of the backend REST API consumed by browser client calls. | No |
| `BACKEND_URL` | `string` | `http://localhost:3001` | No | Server-side API origin used by Next.js SSR / API route proxies. | No |
| `NEXT_PUBLIC_APP_URL` | `string` | `http://localhost:3000` | No | Public origin of the frontend web application. | No |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `string` | `testnet` | **Yes** | Stellar network targeted by Freighter and wallet adapters (`testnet` / `mainnet`). | No |
| `NEXT_PUBLIC_USDC_ISSUER` | `string` | `GBBD47...` | No | Stellar public key for the USDC asset issuer. | No |
| `NEXT_PUBLIC_SOROBAN_FACTORY_CONTRACT_ID` | `string` | — | No | Deployed Soroban project factory contract address. | No |
| `NEXT_PUBLIC_SOROBAN_SETTLEMENT_CONTRACT_ID`| `string` | — | No | Deployed Soroban settlement contract address. | No |
| `NEXT_PUBLIC_ANCHOR_NGN_DOMAIN` | `string` | — | No | Home domain of Nigerian Naira Stellar anchor. | No |
| `NEXT_PUBLIC_ANCHOR_KES_DOMAIN` | `string` | — | No | Home domain of Kenyan Shilling Stellar anchor. | No |
| `NEXT_PUBLIC_ANCHOR_GHS_DOMAIN` | `string` | — | No | Home domain of Ghanaian Cedi Stellar anchor. | No |
| `NEXT_PUBLIC_ANCHOR_ZAR_DOMAIN` | `string` | — | No | Home domain of South African Rand Stellar anchor. | No |
| `NEXT_PUBLIC_ANCHOR_USD_DOMAIN` | `string` | — | No | Home domain of USD Stellar anchor. | No |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `string` | — | No | Base64 URL-encoded VAPID public key for Web Push notifications. | No |
| `NEXT_PUBLIC_SENTRY_DSN` | `string` | — | No | Sentry client DSN for frontend crash reporting. | No |
| `SENTRY_ORG` | `string` | — | No | Sentry organization identifier for source-map uploads in CI. | No |
| `SENTRY_PROJECT` | `string` | — | No | Sentry project identifier for source maps. | No |
| `SENTRY_AUTH_TOKEN` | `string` | — | No | Authentication token for uploading source maps to Sentry. | **Yes** |
| `CSP_MODE` | `string` | `report-only` | No | CSP header mode: `enforce` or `report-only`. | No |

---

## Verifying Environment Coverage in CI

To prevent configuration drift, the repository includes an automated coverage test script:
```bash
cd backend
npm run check:env
```

This scans all `.ts` and `.js` source files under `backend/src` for any `process.env` or `ConfigService.get` calls, comparing them against the entries in `backend/.env.example`. Any undeclared variable causes the build step to fail with a non-zero exit code.
