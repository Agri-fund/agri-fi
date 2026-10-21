# ADR-006: In-Process AML Monitoring over a Projected Cash-Flow View

* **Status:** Accepted
* **Date:** 2026-10-21
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

Issue #1217 requires AML/KYC transaction monitoring: structuring, rapid
pass-through, layering, velocity, high-value and high-risk-jurisdiction patterns,
sanctions and PEP matching, an analyst case workflow, and SAR production.

The constraints that made this a decision rather than a feature list:

* AgriFi already has `RegulatoryRuleEngineService`, which screens a single fact
  set against declarative conditions. It is deliberately stateless — it has no
  notion of "this account's last 30 days".
* Money movement is already recorded, but split across three tables with
  different shapes: `investments` (inflows), `payment_distributions` (payouts)
  and `transaction_logs` (on-chain, no USD amount).
* The platform is a single NestJS API on PostgreSQL with Redis and RabbitMQ.
  There is no stream processor, warehouse or data-lake tier, and the backend CI
  job is a lint / build / Jest / migration-up-and-down pipeline against a
  Postgres service container.
* A compliance officer has to defend every alert to a regulator. A score that
  cannot be explained is not usable as evidence.
* An agency filing channel does not exist for most of the operating
  jurisdictions, so a design that assumed an API filing path would not deploy.

---

## 2. Decision Outcome

Monitoring is implemented **in-process** inside the NestJS API, over a
**read-only projection** of the existing money-movement tables, with **pure
detector functions** and a **feedback-driven sensitivity multiplier**.

Key details:

1. `TransactionMonitoringService.loadCashFlows()` builds one `CashFlow` shape
   (`id, userId, direction, amountUsd, at, dealId, source, counterpartyCountry,
   commodity`) from the three source tables with a raw query builder. Nothing is
   written to a mirror or event table; the projection is recomputed per sweep.
2. Detectors (`aml-detectors.ts`, `aml-behavioral.ts`) are pure functions of
   `(rule, CashFlow[], context) -> PatternMatch[]`. They hold no repository and
   no clock beyond the flows they are given.
3. Each finding carries a `dedupeKey` (`ruleCode:pattern:userId:window bucket`).
   Alerts are inserted only when the key is new, so windows may overlap and a
   backfill may be re-run.
4. Behavioural detection compares an account against **its own** baseline built
   from the older part of its history (amount and cadence mean/stddev, known
   counterpart countries), not a global threshold.
5. Every behavioural finding is re-screened through
   `RegulatoryRuleEngineService.screenTransaction()` and the policy verdict is
   stored on the alert, so the two compliance systems compose instead of
   duplicating.
6. Analyst dispositions feed `sensitivityFromDisposition()`, which rewrites the
   rule's `sensitivity_multiplier`; the multiplier participates in the score, so
   noisy rules self-suppress.
7. Nine new tables prefixed `aml_` (plus `sanctions_list_entries`), created by a
   future-dated migration (`2100000000000`). Statuses and pattern types are
   `varchar` unions mirroring `aml.constants.ts`, the same convention the
   regulatory rule entity already uses.
8. SAR integrity is a SHA-256 over a key-sorted canonical JSON payload; the
   filing service records `channel = 'api'` or `manual_secure_portal` per
   submission and audits both.

---

## 3. Consequences

### Positive Consequences
- **No new infrastructure.** Runs on the existing API, Postgres and scheduler;
  deployment, CI and rollback are unchanged.
- **Deterministic and testable.** Detectors are pure, so pattern logic is covered
  by unit tests without a database, and the same code serves the batch sweep and
  a single-account on-demand check.
- **Traceable evidence.** Because the projection is derived at query time, an
  alert's evidence blob points at real `investments` /
  `payment_distributions` / `transaction_logs` rows rather than at a copy that
  can drift from them.
- **Tunable without a release.** Windows, thresholds, parameters and actions are
  rows; a compliance officer retunes detection without a deploy.
- **Re-runnable.** Dedupe keys make overlapping and historical windows safe.
- **Composes with policy.** The second-stage regulatory screen means behavioural
  findings arrive with a jurisdiction decision already attached.

### Negative Consequences / Trade-offs
- **Sweep cost grows with history.** Detectors are $O(n^2)$ per account within a
  window (`windows()` starts a bucket at every flow). Bounded in practice by the
  per-account flow count in a window, but a very active account is the scaling
  risk and would need windowed pre-aggregation.
- **No real-time blocking.** Detection is scheduled, so an alert lands after the
  movement, not during it. Deal-level blocking remains the regulatory engine's
  job.
- **Projection coupling.** `loadCashFlows()` names source columns directly
  (`amount_usd`, `investor_id`, `trade_deal_id`). A rename in those tables
  silently degrades monitoring and must be checked against this module.
- **Heuristic name matching.** Token-set scoring over normalised names produces
  both false positives on common names and misses on heavy transliteration
  variance; the review band and analyst workflow exist because the score is not
  an identity proof.
- **Self-suppression can hide a pattern.** A rule whose alerts are dismissed as
  false positives is quieted automatically. That is the point, and also the risk
  — the dismissal history itself has to be reviewed.

---

## 4. Alternatives Considered

1. **Option 1: Extend `RegulatoryRule` with time-windowed conditions**
   - *Pros:* One rule store, one engine, no new tables.
   - *Cons:* The engine evaluates one fact set per call; structuring, layering
     and behavioural drift need a series and a baseline, which would push
     aggregation logic into a declarative condition evaluator.
   - *Reason for rejection:* It would make the policy engine carry state it is
     designed not to have. Both are kept, and composed per finding instead.

2. **Option 2: Stream processing (RabbitMQ consumer with per-account window state)**
   - *Pros:* Real-time detection, no rescan of history, scales past large
     windows.
   - *Cons:* Needs durable window state, replay on rule change, and a second
     implementation of every detector that must agree with the batch path.
   - *Reason for rejection:* At current volume the hourly sweep is adequate, and
     the dedupe-key design means a streaming layer can be added later without
     changing detector semantics or the alert schema.

3. **Option 3: External KYT/AML vendor**
   - *Pros:* Vendor-tuned detection, list licensing and regulatory
     attestation.
   - *Cons:* Per-transaction cost, an outbound feed of investor PII, and no
     control over thresholds or explainability shown to an analyst.
   - *Reason for rejection:* The platform's jurisdictions and data-residency
     posture do not permit shipping the full cash-flow ledger to a third party.
     The vendor seam is retained where it already exists —
     `OfacSanctionsCheckService` screens wallets and fails closed when the
     provider is unavailable.

4. **Option 4: Postgres materialized view or ETL mirror for cash flows**
   - *Pros:* Cheaper repeated scans; detectors read one table.
   - *Cons:* Refresh lag and drift risk between the evidence an analyst sees and
     the row that actually moved.
   - *Reason for rejection:* Monitoring volume does not yet justify the extra
     object, and the projection is derived from the source rows so evidence
     stays attributable to them.
