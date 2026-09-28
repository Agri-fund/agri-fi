# Load Testing Guide: k6 Scenarios, Thresholds & Result Interpretation

This guide documents the load testing infrastructure, performance test scenarios, latency budgets, threshold definitions, and regression analysis procedures for the Agri-Fi platform.

The primary test script is maintained at [`tests/load/k6-performance.js`](../../tests/load/k6-performance.js).

---

## 1. Overview & Objectives

Agri-Fi combines traditional REST API services with asynchronous task processing (RabbitMQ) and blockchain settlements (Stellar Horizon & Soroban smart contracts). Under peak demand—such as new seasonal harvest deal launches or bulk escrow milestone payouts—the system must handle concurrent user access without degrading response times or dropping transactions.

Load testing with [k6](https://k6.io/) provides:
- **Continuous Performance Benchmarks**: Verifying that API endpoints meet predefined Service Level Objectives (SLOs).
- **Regression Detection**: Catching latency spikes, memory leaks, and database connection pool exhaustion before production releases.
- **CI/CD Quality Gates**: Enforcing automated threshold checks in CI workflows where performance regressions fail the pipeline.

---

## 2. Running k6 Load Tests

### Prerequisites
- Install [k6](https://k6.io/docs/get-started/installation/) locally (`brew install k6`, `winget install k6`, or download standalone binary).
- Ensure the backend API is up and running (default: `http://localhost:3001`).
- Ensure PostgreSQL, Redis, and RabbitMQ services are healthy (`docker compose up -d`).

### Basic Execution
Run the load test against the default local instance:
```bash
k6 run tests/load/k6-performance.js
```

### Running with Docker
If you do not have k6 installed natively, run via the official Docker image:
```bash
docker run --rm -i \
  -v "$(pwd)/tests/load:/tests/load" \
  --network="host" \
  grafana/k6 run /tests/load/k6-performance.js
```

### Environment Overrides
The script accepts several environment variables for tuning virtual user counts, test duration, credentials, and target hosts:

| Variable | Description | Default |
|---|---|---|
| `BASE_URL` | Target API origin | `http://localhost:3001` |
| `DEAL_ID` | Fallback deal UUID used if marketplace listing is empty | `b0000000-0000-0000-0000-000000000001` |
| `INVESTOR_EMAIL` | Investor user credentials for login | `investor@agri-fi.demo` |
| `INVESTOR_PASSWORD`| Investor account password | `Password123!` |
| `TRADER_EMAIL` | Trader credentials for milestone triggering | `trader@agri-fi.demo` |
| `TRADER_PASSWORD` | Trader account password | `Password123!` |
| `VUS` | Concurrency for marketplace browsing scenario | `40` |
| `DURATION` | Duration for constant-VU scenarios | `30s` |
| `INVESTMENT_VUS` | Peak concurrency for investment creation | `12` |
| `PAYOUT_VUS` | Peak concurrency for escrow payout triggers | `6` |

**Example: Running an extended test against a staging environment:**
```bash
k6 run \
  -e BASE_URL=https://api-staging.agri-fi.com \
  -e VUS=80 \
  -e INVESTMENT_VUS=25 \
  -e PAYOUT_VUS=10 \
  -e DURATION=5m \
  tests/load/k6-performance.js
```

---

## 3. Scenarios Architecture

The test script defines three distinct concurrent scenarios using k6 multi-scenario execution:

```
                  ┌─────────────────────────────────────────┐
                  │          k6 Load Execution              │
                  └───────────────────┬─────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│marketplace_deals │        │investment_crea...│        │  escrow_payout   │
│40 Constant VUs   │        │Ramping VUs (2-12)│        │Ramping VUs (1-6) │
│List & Detail     │        │Invest & Fund     │        │Importer Milestone│
└──────────────────┘        └──────────────────┘        └──────────────────┘
```

### Scenario 1: `marketplace_deals`
- **Executor**: `constant-vus`
- **VUs**: 40 concurrent virtual users
- **Duration**: 30 seconds (configurable via `DURATION`)
- **Simulated Flow**:
  1. Requests `GET /v1/trade-deals?page=1&limit=12` (tagged as `ListOpenDeals`).
  2. Extracts an active deal ID from the response payload.
  3. Requests `GET /v1/trade-deals/:id` (tagged as `GetDealDetail`).
  4. Pauses with a small jitter sleep (100ms) before the next iteration.
- **Goal**: Simulates baseline traffic of retail and institutional investors browsing live agricultural listings, filtering commodities, and viewing deal prospectuses.

### Scenario 2: `investment_creation`
- **Executor**: `ramping-vus`
- **Stages**:
  - `30s`: Ramp up from 2 to 12 VUs.
  - `2m00s`: Steady peak load at 12 VUs.
  - `30s`: Ramp down to 6 VUs.
- **Simulated Flow**:
  1. Uses the authenticated investor JWT generated in the `setup()` lifecycle hook.
  2. Fetches open deals and constructs dynamic token investment orders.
  3. Calls `POST /v1/investments` with variable lot sizes (tagged as `CreateInvestment`).
  4. Follows up with `POST /v1/investments/:id/fund` containing signed mock Stellar transaction envelopes (tagged as `FundEscrow`).
- **Goal**: Tests write performance, relational constraints, transaction isolation levels, and token inventory decrement logic under concurrency.

### Scenario 3: `escrow_payout`
- **Executor**: `ramping-vus`
- **Stages**:
  - `20s`: Ramp up from 1 to 6 VUs.
  - `2m00s`: Steady load at 6 VUs.
  - `20s`: Ramp down to 1 VU.
- **Simulated Flow**:
  1. Uses authenticated trader JWT.
  2. Submits `POST /v1/shipments/milestones` with `milestone: "importer"` (tagged as `RecordImporterMilestone`).
  3. Verifies response payload for payout queue dispatch.
- **Goal**: Exercises final settlement logic, background RabbitMQ outbox publishing, and multi-party payout calculations (98% farmer, proportional investor returns, 2% platform fee).

---

## 4. Current Performance Budgets & Thresholds

Agri-Fi enforces hard thresholds configured directly in the k6 script options. If any threshold is breached, k6 immediately marks the run as failed and exits with non-zero code `99`.

| Metric / Tag | Threshold | SLO Rationale |
|---|---|---|
| `http_req_failed` | `< 0.05` (< 5%) | Overall error rate (4xx/5xx) must remain under 5% under burst load. |
| `http_req_duration{name:ListOpenDeals}` | `p(95) < 250ms` | Cached marketplace catalog read latency must return in under 250ms at 95th percentile. |
| `http_req_duration{name:GetDealDetail}` | `p(95) < 250ms` | Deal metadata and milestone overview retrieval must return in under 250ms at 95th percentile. |
| `http_req_duration{name:CreateInvestment}` | `p(95) < 1500ms` | Deal booking with DB transaction and row-level checks must finish under 1.5s at p95. |
| `http_req_duration{name:FundEscrow}` | `p(95) < 2000ms` | Escrow verification, cryptographic signature validation, and queue dispatch must complete under 2.0s at p95. |
| `http_req_duration{name:RecordImporterMilestone}` | `p(95) < 2000ms` | Shipment milestone registration and payout pipeline trigger must complete under 2.0s at p95. |

---

## 5. Reading and Interpreting Results

At the conclusion of a test run, k6 outputs a comprehensive metrics table. Here is how to parse and interpret each section:

```
     ✓ login returns 200
     ✓ list returns 200
     ✓ detail returns 200
     ✓ investment request handled

   ✓ http_req_duration..................................: avg=185.2ms min=12.1ms med=142.3ms max=2.1s p(90)=220ms p(95)=245ms
       { name:ListOpenDeals }...........................: avg=98.4ms  min=14.2ms med=85.1ms  max=310ms p(95)=195ms
       { name:GetDealDetail }...........................: avg=82.1ms  min=11.5ms med=72.0ms  max=280ms p(95)=180ms
       { name:CreateInvestment }........................: avg=640.2ms min=210ms  med=580ms   max=1.8s  p(95)=1.1s
       { name:FundEscrow }..............................: avg=890.1ms min=320ms  med=810ms   max=2.4s  p(95)=1.6s
       { name:RecordImporterMilestone }.................: avg=780.5ms min=290ms  med=710ms   max=2.2s  p(95)=1.4s
   ✓ http_req_failed....................................: 0.12%   ✓ 4        ✗ 3120
     http_reqs..........................................: 3124    52.06/s
     iteration_duration.................................: avg=1.2s    min=410ms  med=1.1s    max=3.8s  p(95)=2.1s
     iterations.........................................: 2480    41.33/s
     vus................................................: 58      min=1      max=58
     vus_max............................................: 58      min=58     max=58
```

### Key Metrics Guide:
1. **`http_req_duration`**: Time spent making HTTP requests (includes DNS lookup, TLS handshake, data sending, waiting for server response [TTFB], and receiving content).
   - **`p(95)`**: The 95th percentile latency. 95% of all requests completed faster than this value. This is our primary Service Level Objective indicator.
   - **`p(99)` / `max`**: Used to identify tail latency anomalies (e.g. garbage collection pauses or database connection pool acquisition waits).
2. **`http_req_failed`**: The ratio of failed requests (HTTP status >= 400 or network timeouts). A rate above 0.05 violates our threshold.
3. **`checks`**: The proportion of application-level assertions passed (e.g., verifying that returned data is an array or deal IDs match).
4. **`iterations` and `vus`**: Total executed loop iterations and the concurrent virtual user count.

### Diagnosing Performance Regressions:

| Symptom | Probable Cause | Investigation Steps |
|---|---|---|
| **High `http_req_failed` (> 5%)** | Rate limiting / throttler activation or auth failure | Check `app.module.ts` throttler configuration (`@nestjs/throttler`), review server logs for `429 Too Many Requests`. |
| **`ListOpenDeals` p95 > 250ms** | Redis cache miss or missing index on `trade_deals(status, created_at)` | Verify Redis connection (`REDIS_URL`), check database query execution plan using `EXPLAIN ANALYZE SELECT ... FROM trade_deals`. |
| **`CreateInvestment` p95 > 1500ms** | Database row locking or connection pool exhaustion | Check `DATABASE_POOL_MAX` and `DATABASE_POOL_CONNECTION_TIMEOUT_MS`. Look for deadlock warnings in PostgreSQL logs. |
| **`FundEscrow` p95 > 2000ms** | Stellar Horizon RPC latency or RabbitMQ publish blockage | Check Horizon client response time, check RabbitMQ channel saturation and broker disk alarms. |
| **Gradual latency increase over time** | Memory leak or connection leak | Monitor container memory with `docker stats` or Grafana / Prometheus memory graphs (`process_resident_memory_bytes`). |

---

## 6. Storing Baselines and Exporting Metrics

### Exporting JSON Summaries
Export structured test results for CI reporting or regression tracking:
```bash
k6 run --summary-export=load-summary.json tests/load/k6-performance.js
```

### Comparing Against Baseline
Store baseline files in `tests/load/baselines/` or as CI artifacts:
- When changes are introduced to database queries or critical business flows, run k6 and compare the resulting `http_req_duration.p(95)` against `tests/load/baselines/baseline-latest.json`.
- A regression is flagged if any scenario's p95 latency exceeds 115% of the baseline without an approved architectural justification.

---

## 7. Tying Thresholds to the CI Gate

When k6 fails a threshold condition, it exits with status code `99`. This property enables automated CI blocking:

In GitHub Actions workflows (e.g., `.github/workflows/ci.yml` and `backend-ci.yml`), load tests can be triggered as a scheduled nightly check or pre-release gate:

```yaml
      - name: Run k6 Load Test Suite
        run: |
          k6 run \
            -e BASE_URL=http://localhost:3001 \
            -e DURATION=45s \
            --summary-export=backend/k6-summary.json \
            tests/load/k6-performance.js
        env:
          DEAL_ID: "b0000000-0000-0000-0000-000000000001"
```

If any endpoint exceeds its p95 budget (e.g., `ListOpenDeals` exceeding 250ms), the job will fail, preventing broken or regressed code from merging into `main`.

---

## 8. When and How to Update Performance Budgets

Performance budgets are strict commitments and must not be relaxed arbitrarily.

### Allowed Reasons for Updating Budgets:
1. **Architectural Shifts**: Introducing new asynchronous offloading mechanisms that intentionally trade initial sync latency for background processing.
2. **Infrastructure Spec Changes**: Upgrades or resizing of PostgreSQL RDS instances or multi-AZ replica nodes.
3. **New Cryptographic / Compliance Requirements**: Adding hardware security module (HSM) signing or multi-sig co-signers that measurably shift cryptographic processing time.

### Process for Budget Updates:
1. Run a minimum of **5 consecutive load test iterations** on a dedicated, staging environment with production-sized dataset.
2. Calculate the mean p95 and p99 values across all 5 runs.
3. Submit a Pull Request documenting:
   - The proposed new thresholds in `tests/load/k6-performance.js`.
   - The corresponding updates in this document.
   - The test summary output and rationale.
4. Require review and sign-off from Platform Engineering and Tech Lead before merging.
