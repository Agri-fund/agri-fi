# Security Hardening Checklist: Implemented vs. Monitored Controls

This document provides a consolidated security hardening matrix for the Agri-Fi platform. It catalogs all defensive controls, where they are implemented in the codebase or infrastructure, how they are verified, their operational monitoring status, and identified gaps requiring follow-up.

---

## 1. Classification & Status Definitions

To provide auditors, compliance officers, and engineers with an accurate operational picture, controls are classified into three statuses:

- **Implemented & Monitored (🟢)**: The control is active in code/infrastructure, covered by automated tests, and has real-time observability (Prometheus metrics, Sentry error tracking, alert webhooks, or health probes).
- **Implemented Only (🟡)**: The control is statically enforced in code, configuration, or database rules, but lacks dedicated live telemetry or automated alerting on violation attempts.
- **Gap / Planned (🔴)**: The control is partially implemented or represents an unmonitored risk surfaced during threat modeling, flagged for immediate engineering follow-up.

---

## 2. Master Security Hardening Matrix

| # | Security Control | Component / Implementation Location | Verification Method | Status | Monitoring Mechanism |
|---|---|---|---|---|---|
| **1** | **PostgreSQL Row-Level Security (RLS)** | `backend/src/database/migrations/1716300000009-EnableRLS.ts`, `1950000000000-CompleteInvestorRLS.ts`, `UserContextInterceptor` | Unit & migration tests (`1950000000000-CompleteInvestorRLS.spec.ts`) | 🟡 **Implemented Only** | Database logs capture policy denials; no dedicated Prometheus metric for unauthorized row access attempts. *(Gap flagged below)* |
| **2** | **Antivirus Scanning (ClamAV)** | `backend/src/documents/clam-scan.service.ts`, `documents.controller.ts` | Unit test suite (`documents.service.spec.ts` verifies fail-closed behavior) | 🟢 **Implemented & Monitored** | Health check probes TCP port 3310; failed scans log errors and emit Sentry events. |
| **3** | **API Rate Limiting & Throttling** | `backend/src/app.module.ts`, `@nestjs/throttler`, controller decorators on `/v1/auth/*`, `/v1/investments`, `trade-deals`, and `GqlThrottlerGuard` | Controller specs (`auth.controller.spec.ts`, `investments.controller.spec.ts`, `auth-token.e2e-spec.ts`) | 🟢 **Implemented & Monitored** | Throttler emits HTTP `429 Too Many Requests`; rate-limit exhaustion triggers Prometheus counter and Sentry breadcrumbs. |
| **4** | **HTTP Security Headers & Helmet** | `backend/src/main.ts` (`helmet`), `security-headers.middleware.ts`, `frontend/next.config.js` | Integration tests, automated OWASP ZAP scan in `.github/workflows/security.yml` | 🟢 **Implemented & Monitored** | Weekly ZAP security scanner verifies HSTS, X-Content-Type-Options, X-Frame-Options DENY, and Referrer-Policy. |
| **5** | **Content Security Policy (CSP)** | `frontend/next.config.js` (headers block with `CSP_MODE` toggle), `backend/src/main.ts` | Automated browser tests via Playwright, Trivy/ZAP security scans | 🟡 **Implemented Only** | CSP directives enforced in browser; violation reporting configured via `report-uri /api/csp-report` but backend ingestion is unmonitored. |
| **6** | **DNS Rebinding Protection** | `backend/src/main.ts` (`ALLOWED_HOSTS` validation middleware) | Unit & e2e request tests | 🟢 **Implemented & Monitored** | Non-whitelisted hosts rejected with HTTP 421 Misdirected Request; logged to Pino audit trail. |
| **7** | **CSRF Defense (Cookie Session)** | `backend/src/main.ts` (`csurf` middleware with `SameSite: strict` HTTP-only cookies, `/csrf-token` route) | E2E authentication suites | 🟡 **Implemented Only** | Invalid CSRF token returns HTTP 403 `EBADCSRFTOKEN`; no real-time Prometheus alert on burst failures. |
| **8** | **Transport Encryption (TLS/HTTPS)** | Kubernetes Ingress with Let's Encrypt / Cert-Manager, `backend/src/config/redis.config.ts` (Redis TLS) | SSL Labs validation, CI TLS handshake checks | 🟢 **Implemented & Monitored** | Ingress cert expiration alerts via Prometheus blackbox exporter; Redis connection handshake monitoring. |
| **9** | **Secrets Management & Sealed Secrets** | `backend/src/config/aws-secrets.ts`, `k8s/secrets.yaml`, `.github/workflows/secrets-check.yml` | Trufflehog / Gitleaks in CI, `secrets-check.yml` | 🟢 **Implemented & Monitored** | AWS Secrets Manager rotation handler (`rotationHandler`); CI secrets leak scanner blocks PRs. |
| **10**| **Column Encryption at Rest** | `backend/src/kms/kms.service.ts`, `backend/src/queue/queue.crypto.ts`, `1765000000000-AddPiiEncryptedColumns.ts` | Property-based tests, `aws-kms.spec.ts` | 🟢 **Implemented & Monitored** | AWS KMS envelope encryption metrics; failure in decryption triggers immediate operational alert. |
| **11**| **Database Backups & Verification** | `backend/k8s/backup-verify-job.yaml`, `backend/scripts/verify-restore.sh` | Automated cron job testing backup integrity and restoration | 🟢 **Implemented & Monitored** | Nightly backup verification job reports success/failure to Slack/Discord webhooks. |
| **12**| **Comprehensive Audit Logging** | `backend/src/audit/audit.interceptor.ts`, `audit.service.ts`, `system-audit-log.entity.ts`, `AuditLog` | Unit tests (`audit.spec.ts`), activity feed integration | 🟢 **Implemented & Monitored** | Persisted in PostgreSQL and streamed to structured Pino logger; admin audit trail exposed in UI. |
| **13**| **Credential-Stuffing & Threat Defense**| `backend/src/auth/security-threat.service.ts`, hCaptcha integration, `SECURITY_BAD_IP_RANGES` | Unit tests for IP tracking and country hopping detection | 🟢 **Implemented & Monitored** | Alerts sent to `SECURITY_OPS_EMAIL` and webhook when distinct IP or country thresholds are breached. |
| **14**| **Stellar Escrow Multi-Signature** | `backend/src/stellar/stellar.service.ts`, multi-sig signers (`STELLAR_MULTISIG_SIGNER_1_SECRET`, `_2_SECRET`) | Stellar testnet integration tests, multi-sig transaction validation | 🟢 **Implemented & Monitored** | Platform balance monitoring alerts on low reserve (`STELLAR_MONITOR_BALANCE_THRESHOLD`). |
| **15**| **Soroban State Rent Expiration** | `backend/src/soroban/soroban-rent.service.ts` | Scheduled cron check every 6 hours | 🟢 **Implemented & Monitored** | Proactively bumps contract storage TTL (`SOROBAN_EXTEND_TO_LEDGERS`); alerts on TTL < 5 days. |
| **16**| **Input Validation & SQLi Prevention**| Global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`), TypeORM parameterized queries | NestJS pipe tests, unit tests across all DTOs | 🟢 **Implemented & Monitored** | Validation rejections log 400 Bad Request with field-level attribution; SonarQube quality gate blocks unparameterized queries. |
| **17**| **Document Digital Signature Integrity**| `backend/src/documents/pgp-verify.service.ts`, `TRUSTED_AUTHORITY_KEYS` | Document upload verification tests | 🟡 **Implemented Only** | Verifies PGP signatures on trade certificates; signature rejections logged but lack aggregated telemetry. |
| **18**| **IoT Cargo Telemetry Guardrails** | `backend/src/shipments/sensor-monitor.service.ts`, configurable ranges (`SENSOR_TEMP_*`, `SENSOR_HUMIDITY_*`) | Unit & integration tests on telemetry ingestion | 🟢 **Implemented & Monitored** | Out-of-bounds sensor readings trigger webhook alerts and dispute flags on deal escrow. |

---

## 3. Threat Framework Mapping (OWASP Top 10 & SRIOT)

### OWASP Top 10 (2021) Mapping

| OWASP Vulnerability | Agri-Fi Implemented Safeguard | Verification & Observability |
|---|---|---|
| **A01: Broken Access Control** | PostgreSQL Row-Level Security (RLS) on user/investor data; JWT role guards (`@Roles('trader')`, `@Roles('admin')`). | Unit tests in `1950000000000-CompleteInvestorRLS.spec.ts`; auth guards verified in e2e tests. |
| **A02: Cryptographic Failures** | AES-256-CBC envelope encryption via AWS KMS; encrypted RabbitMQ payloads; HSTS preloading with 1-year max-age. | `aws-kms.spec.ts`; SSL Labs grade A+ verification. |
| **A03: Injection** | TypeORM query builder with strict parameterization; global `ValidationPipe` disallowing undeclared fields. | SonarQube static code analysis; DTO validation suites. |
| **A04: Insecure Design** | 2-of-3 multi-signature escrow accounts; time-locked milestone payouts; smart contract state expiration managers. | Soroban property tests; testnet integration runs. |
| **A05: Security Misconfiguration** | Helmet security headers; removal of `x-powered-by`; strict CORS origin whitelisting; Swagger Basic-Auth in prod. | ZAP automated vulnerability scan; Trivy container scans. |
| **A06: Vulnerable and Outdated Components** | Automated Dependabot and Trivy vulnerability scanners in `.github/workflows/docker-scan.yml`. | Weekly Trivy SARIF report uploaded to GitHub Security tab. |
| **A07: Identification and Authentication Failures** | Brute-force throttling via `@nestjs/throttler`; hCaptcha verification; credential-stuffing defense service. | E2E authentication specs; ops email alerts on abnormal logins. |
| **A08: Software and Data Integrity Failures** | ClamAV antivirus scanning for all uploaded documents; PGP signature validation for quality certificates. | ClamAV integration test; fail-closed validation on offline scanner. |
| **A09: Security Logging and Monitoring Failures** | Pino structured JSON logging; global `AuditInterceptor`; Prometheus scraping on `/metrics`. | System audit log entities; Sentry exception monitoring. |
| **A10: Server-Side Request Forgery (SSRF)** | URL and redirect sanitizers in `backend/src/auth/utils/redirect-sanitizer.ts`; IPFS gateway whitelist. | Unit tests rejecting protocol-relative and external open redirects. |

### SRIOT (Smart Contract, IoT & Supply Chain) Threat Matrix

| Risk Domain | Potential Impact | Implemented Mitigation |
|---|---|---|
| **Smart Contract Rent Starvation** | Escrow payout locks up due to expired contract storage on Soroban. | `SorobanRentService` runs every 6 hours, restoring TTL to 535,680 ledgers with alerts on low TTL. |
| **Cold-Chain Spoofing / Tampering** | Rotten produce delivered while milestone payout releases automatically. | `sensor-monitor.service.ts` validates temperature, humidity, and CO2 thresholds before releasing importer milestone. |
| **Escrow Account Drain** | Compromised platform server initiates unauthorized fund transfer. | Stellar 2-of-3 multi-signature requirement (`STELLAR_MULTISIG_SIGNER_1_SECRET`, `_2_SECRET`). Single compromised key cannot authorize release. |

---

## 4. Flagged Gaps for Follow-Up

The following items are identified as **Implemented Only** or require enhanced operational observability:

### Gap 1: Real-time Telemetry on PostgreSQL RLS Policy Violations
- **Issue**: When an unauthorized query violates RLS, PostgreSQL silently filters the rows or rejects the statement, but no real-time alert is delivered to security operations.
- **Recommended Remediation**: Add a database event notification or application-level interceptor that increments a Prometheus counter `agri_security_rls_violations_total` when a tenant mismatch query occurs.

### Gap 2: Automated Ingestion Pipeline for CSP Reports
- **Issue**: `frontend/next.config.js` defines `report-uri /api/csp-report`, but reports are not currently stored in a searchable database or sent to Sentry.
- **Recommended Remediation**: Create an endpoint `POST /api/csp-report` in the frontend API proxy or backend to forward CSP violation payloads directly into Sentry or CloudWatch.

### Gap 3: ClamAV Daemon Downtime Alerting
- **Issue**: If the ClamAV Docker container crashes, document uploads fail closed (which is secure), but operations only learns of the outage when users report upload failures.
- **Recommended Remediation**: Expose ClamAV daemon connectivity as an active check in `health.controller.ts` under `@nestjs/terminus` so Kubernetes alerts on daemon downtime.

### Gap 4: Automated KMS Key Rotation Verification
- **Issue**: Automatic key rotation is enabled in AWS KMS, but application startup does not actively verify that the rotation cadence is adhering to the 365-day schedule.
- **Recommended Remediation**: Add an inspection step to `KmsService.onModuleInit()` that calls `DescribeKey` and logs the rotation state.
