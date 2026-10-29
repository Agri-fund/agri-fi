# AML / KYC Transaction Monitoring

Issue: `#1217`. The module lives in `backend/src/aml/` and is wired into the
application by `AmlMonitoringModule` (`backend/src/app.module.ts`).

AgriFi already screens a single fact set against static policy through the
[Regulatory Rule Engine](./regulatory-rule-engine.md). That answers "is this
transaction allowed?" but not "is this account behaving in a way that suggests
layered money is passing through it?". Monitoring closes that gap: it watches
money movements over time windows, matches names against sanctions and PEP
lists, routes findings into a case workflow an analyst can defend, and produces
filing-ready suspicious activity reports.

Both are consulted during a sweep. The behavioural detectors find the pattern,
the rule engine then re-screens the same money movement for jurisdiction policy,
and the policy verdict is stored on the alert as evidence.

---

## Overview

| Capability | Description |
| --- | --- |
| **Configurable rules** | Seven detectors ship as editable `aml_monitoring_rules` rows with their own window, thresholds, parameters, action and base score. |
| **Behavioural analysis** | Each account's own history (amount mean/stddev, cadence, known counterpart countries) is the baseline; deviations are scored by z-score, not a global threshold. |
| **Sanctions / PEP screening** | Normalised-name token matching with explainable scores, graded partial-date-of-birth agreement, wallet screening through the existing KYT provider, and periodic re-screening of verified users. |
| **Alert triage queue** | Alerts are ordered by risk score, deduplicated by an idempotency key, and carry the evidence that produced them. |
| **Case workflow** | Alerts roll into cases with priority-driven SLA due dates, an append-only timeline, and a close disposition. |
| **Feedback learning** | Analyst dispositions retune each rule's `sensitivity_multiplier`, so a rule that is 90% false positive quiets down. |
| **SAR drafting** | Deterministic narrative plus subjects/activities from a case, with a SHA-256 integrity hash over the canonical payload. |
| **Regulatory filing** | Submission queue with an HTTP transport when configured and a recorded manual-portal filing when it is not. |
| **Scheduling** | `@nestjs/schedule` cron jobs for the sweep, the daily re-screen, and submission retries. |
| **Audit trail** | Sweeps are recorded in `aml_monitoring_runs`; every mutating admin route passes through `AuditInterceptor`. |

---

## Data sources

Monitoring does not write its own ledger. Cash flows are projected from the
tables that already hold the money movement, so a finding is always traceable
back to a row an investor or company already sees:

| Source table | Direction | What it means |
| --- | --- | --- |
| `investments` | `in` | Investor capital arriving into a deal. |
| `payment_distributions` (`recipient_type = 'investor'`, `status = 'confirmed'`) | `out` | Confirmed payouts leaving the platform. |
| `transaction_logs` (`status = 'success'`) | `out` | On-chain activity. No USD amount, so it contributes velocity, layering and cadence signal but never a sum. |

Deal `country` and `commodity` are joined in from `trade_deals` so jurisdiction
and commodity context survive into the evidence blob.

---

## Architecture

```
              ┌──────────────────────────────────────────────┐
              │  investments / payment_distributions /       │
              │  transaction_logs            (existing data)  │
              └───────────────────────┬──────────────────────┘
                                      │ loadCashFlows(from, to, user?)
                                      ▼
                        ┌───────────────────────────┐
                        │  TransactionMonitoring     │
                        │  Service.runSweep()        │
                        └───────────┬───────────────┘
             active rules ──────────┤
        (AmlRulesService)           ▼
       ┌───────────────────────────────────────────────┐
       │ aml-detectors.ts / aml-behavioral.ts (pure)   │
       │ STRUCTURING  RAPID_MOVEMENT  LAYERING         │
       │ VELOCITY     HIGH_VALUE      HIGH_RISK_JURIS  │
       │ BEHAVIORAL_ANOMALY  (z-score vs own baseline) │
       └───────────────────────┬───────────────────────┘
                               │ PatternMatch[] + dedupeKey
             second-stage screening
                   RegulatoryRuleEngineService.screenTransaction()
                               ▼
                  ┌────────────────────────┐  risk >= AML_AUTO_CASE_THRESHOLD_SCORE
                  │ aml_alerts (pending)   ├────────────────┐
                  └───────────┬────────────┘                ▼
                              │ triage / escalate  ┌──────────────────┐
                              └────────────────────► │ aml_cases        │
                                                   │ timeline + SLA   │
                                                   └────────┬─────────┘
                                                            │ generate
                                                            ▼
                                              ┌───────────────────────────┐
                                              │ aml_sar_reports (sha256)  │
                                              └────────────┬──────────────┘
                                                           │ submit
                                                           ▼
                                     ┌────────────────────────────────────┐
                                     │ aml_regulatory_submissions         │
                                     │ channel: api | manual_secure_portal│
                                     └────────────────────────────────────┘
```

Sanctions screening runs beside this flow: `SanctionsListService` holds the
loaded entries, `SanctionsScreeningService` scores a subject against them and
raises `SANCTIONS_MATCH` / `PEP_MATCH` alerts into the same queue.

---

## Detectors

All detectors are pure functions over `CashFlow[]` plus a rule row, in
`aml-detectors.ts` and `aml-behavioral.ts`. That keeps the pattern logic testable
without a database and identical for the batch sweep and the single-account path.

| Pattern | What it looks for | Default rule | Default parameters |
| --- | --- | --- | --- |
| `STRUCTURING` | Several inflows each at or below the reporting ceiling that together reach it inside the window. | `AML-MON-STRUCT-001`, HIGH, 24h, base 70 | `maxIndividualAmountUsd 9500`, `aggregateThresholdUsd 10000`, `minFlowCount 3` |
| `RAPID_MOVEMENT` | Funds arriving and leaving again at near full value inside the window (pass-through / funnel account). | `AML-MON-RAPID-001`, HIGH, 48h, base 65 | `movementRatio 0.9`, `minInflowUsd 1000` |
| `LAYERING` | In/out interleaving across several distinct deals. | `AML-MON-LAYER-001`, CRITICAL, 7d, base 80 | `minDistinctDeals 3`, `minFlowCount 4` |
| `VELOCITY` | More movements in a window than the account should perform. | `AML-MON-VELO-001`, MEDIUM, 24h, base 50 | `maxFlowsPerWindow 12` |
| `HIGH_VALUE` | A single movement at or above the EDD ceiling. | `AML-MON-HV-001`, MEDIUM, 24h, base 55 | `amountThresholdUsd 50000` |
| `HIGH_RISK_JURISDICTION` | Account country or deal counterparty country on the watchlist. | `AML-MON-JURIS-001`, HIGH, 30d, base 60 | `countries []` (deployment loads its own) |
| `BEHAVIORAL_ANOMALY` | Amount or cadence far outside the account's own baseline, or a first movement to a new jurisdiction. | `AML-MON-BEHAV-001`, MEDIUM, 30d, base 45 | `zScoreThreshold 3`, `minHistorySamples 5` |

`REQUIRED_PARAMETERS` in `aml-detectors.ts` is the contract `AmlRulesService`
validates against, so a rule cannot be saved with parameters its detector will
not read.

### Scoring

`riskScore = clamp(baseRiskScore × sensitivityMultiplier × (1 + magnitudeBoost))`

`magnitudeBoost` is log-scaled over the rule's own threshold: 10x is +0.25,
100x +0.5, 1000x +0.75, capped there. A $50m single movement therefore scores
higher than a $60k one under the same rule, without needing another rule row.

`sensitivityMultiplier` is written back by the feedback loop, not by hand.

### Behavioural baseline

A fixed threshold catches the obvious cases but flags a legitimate institutional
investor. `buildBaseline()` therefore splits each account's series and computes
mean/stddev of amount, mean/stddev of inter-arrival hours, and the set of
counterpart countries from the *older* part of the history only, so a burst is
compared against normal behaviour rather than against itself. `findBehaviouralAnomalies()`
scores the most recent movements against it and requires at least
`minHistorySamples` historical rows before it says anything at all.

An account with a flat history that sends one $18,000 payment to a country it has
never touched produces three reasons on one alert: amount z-score, cadence
z-score, and `first movement involving AE`. All three are stored in the evidence
so the analyst sees the arithmetic.

### Idempotency

Every match carries a `dedupeKey` of the form
`<ruleCode>:<pattern>:<userId>:<window bucket or flow id>`. A sweep queries
existing keys before writing, so re-running the same window — or running an
overlap window — cannot double-alert. This is what makes it safe to re-run a
backfill after tuning a rule.

---

## Sanctions and PEP screening

Matching runs on normalised token sets, not raw strings, because sanctions lists
and KYC records describe the same person with different punctuation, case,
transliteration and legal-form suffixes.

`normaliseSanctionsName()` lowercases, strips diacritics and punctuation, and
drops noise tokens (`limited`, `ltd`, `incorporated`, `corp`, `holding`, `the`,
…). `scoreNameSimilarity()` returns the score *with* its components:

| Condition | Score | `method` |
| --- | --- | --- |
| Normalised names identical (including any alias) | 100 | `exact` |
| One name fully contained in the other, both 2+ tokens | ≥90 | `token_overlap` |
| Two or more shared tokens | ≥70, +5 per extra token | `token_overlap` |
| Single shared token on short names | capped at 65 | `partial` |
| Nothing shared | 0 | `none` |

`dateOfBirthAgreement()` is graded because lists store partial dates
("1960", "1960-04"): full agreement adds 8, year-prefix agreement adds 4,
otherwise 0. The bonus is added to the name score and capped at 100, and the
reason string records it ("date of birth agrees (+8)") so the score stays
explainable.

Two config thresholds decide the outcome, and they are deliberately different:

* `AML_SANCTIONS_MATCH_THRESHOLD` (default 85) — a `match`. Severity `CRITICAL`,
  alert risk score 100.
* `AML_SANCTIONS_REVIEW_THRESHOLD` (default 70) — `review`. Severity `HIGH`, risk
  score capped at 99, because a 72-similarity hit on a common name is a human
  decision rather than a confirmed listing.

Both raise a `SANCTIONS_MATCH` (or `PEP_MATCH`) alert and open a case, and both
also write into the pre-existing `compliance_alerts` table so the KYC admin view
keeps showing sanctions hits alongside the rest of its data. PEP findings are
`HIGH` rather than `CRITICAL`: being a politically exposed person is a reason for
enhanced due diligence, not an automatic refusal.

Wallet subjects go through the existing `OfacSanctionsCheckService` when it is
configured. A provider outage is recorded as `review` with score 50 rather than
`clear` — an unavailable screener is not a clean bill of health.

List loading (`POST /v1/admin/aml/sanctions/import`) upserts by `externalId` when
the source provides one and by normalised name otherwise, skips entries with no
name, and returns a SHA-256 checksum over the identities it touched so two
operators can confirm they loaded the same version of a list.

---

## Case workflow

`AmlAlert` is the finding; `AmlCase` is the unit of work. A case takes the
highest severity of its alerts as its priority and derives an SLA due date:

| Priority | Due in |
| --- | --- |
| `CRITICAL` | 3 days |
| `HIGH` | 5 days |
| `MEDIUM` | 10 days |
| `LOW` | 30 days |

Every state change appends to `timeline` (`{ at, action, actorId, detail }`), so
the case can be read as a narrative by someone who was not there. Alerts are
linked, not copied — `case.alertIds` plus `alert.caseId` — which is why one
alert cannot be pulled into a second case.

An auto-opened case is suppressed while the same account already has a
non-closed case for the same rule code; otherwise a persisting pattern would
open a new case every hour.

`AmlCaseService.summary()` reports open/in-review/escalated/closed counts and
overdue cases for the admin dashboard; `overdueCases()` is what the daily job
surfaces.

---

## Feedback loop

Analysts dispose of alerts as `false_positive`, `sar_filed`, `no_action`,
`referred_to_authority` or `account_restricted`. Each disposition writes an
`aml_disposition_feedback` row, and when the alert came from a monitoring rule
(that is, `alert.ruleId` is set — sanctions findings have no rule) the row also
records `sensitivityBefore`/`sensitivityAfter` while the rule's FP/TP counters
are re-bucketed with `sensitivityFromDisposition(falsePositives, truePositives)`:

| Conditions | Multiplier |
| --- | --- |
| Fewer than 5 labelled outcomes | 1.0 (no adjustment — too little data) |
| FP rate ≥ 0.9 | 0.4 |
| FP rate ≥ 0.75 | 0.6 |
| FP rate ≥ 0.5 | 0.8 |
| FP rate ≥ 0.25 | 1.0 |
| FP rate < 0.25 | 1.25 |

The floor of 5 labelled outcomes matters: a rule dismissed once should not go
quiet. Because the multiplier feeds the score, and the score feeds the
`alertThresholdScore` cut-off, a noisy rule self-suppresses before it buries the
queue.

---

## SAR generation and filing

`SarGenerationService.generate()` builds a report from a case: the subject's KYC
identity, one numbered activity line per alert (timestamp, title, matched reason,
amount), the pattern and rule-code sets, the observed window and total, and the
case priority and risk score. The narrative explicitly records that no customer
notification was issued, consistent with tipping-off restrictions.

`sha256Hash` covers a canonical JSON payload with sorted keys
(`sarNumber, jurisdiction, authority, filingType, subjects, activities,
suspiciousAmountUsd, activityFrom, activityTo, narrative`).
`GET /v1/admin/aml/sar/:id/verify` recomputes it and reports whether the stored
report still matches, which is the answer to "was this report altered after it
was filed?".

Filing refuses a `draft` report — an officer must call
`POST /v1/admin/aml/sar/:id/review` first — and refuses a report that is already
`submitted` or `acknowledged`.

Transport is decided per submission and recorded:

* `channel = 'api'` when `AML_REGULATORY_REPORTING_ENABLED=true` **and** an
  endpoint and API key are configured. A 4xx from the authority is `rejected`
  (fix and re-file); a 5xx, timeout or network failure is `failed` (retryable).
* `channel = 'manual_secure_portal'` otherwise, including when the operator
  passes `manualFiling: true`. The submission row is still created and audited,
  with the message that the filing must be made on the portal. Most jurisdictions
  have no machine-to-machine filing channel, so this is the normal path, not the
  fallback for a misconfiguration.

`GET /v1/admin/aml/submissions/metrics` returns the counts and channel split the
compliance officer needs to prove that every SAR reached an authority.

---

## Scheduling

`AmlMonitoringCronService` uses `@nestjs/schedule`, which `AppModule` already
registers.

| Job | Cadence | Behaviour |
| --- | --- | --- |
| Sweep | hourly | Calls `ensureDefaults()` first so a fresh database starts monitoring without manual setup, then sweeps the last hour. Detectors still see the full rule window because `runSweep()` loads history `maxWindowHours` before the window start; only findings whose triggering movement falls inside the hour are reported, which is what stops consecutive ticks from re-raising the same pattern. Guarded by an in-flight flag so a slow sweep cannot overlap the next tick. |
| Re-screen | daily 02:00 | Rescreens verified users against the loaded sanctions list. |
| Submission retry | every 30 min | Retries `channel = 'api'` submissions that are still pending acceptance. Manual-portal rows are not retried — nothing is outstanding once the operator records the filing. |

`AML_MONITORING_ENABLED=false` makes the cron and `runSweep()` return a
`status: 'skipped'` result without touching data — the kill switch for an
incident or a jurisdiction where monitoring is not yet approved.

---

## Configuration

Documented in `backend/.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AML_MONITORING_ENABLED` | `true` | Master kill switch for sweeps and cron. |
| `AML_AUTO_CASE_THRESHOLD_SCORE` | `70` | Risk score at or above which a case is opened automatically. |
| `AML_SANCTIONS_MATCH_THRESHOLD` | `85` | Score treated as a sanctions match. |
| `AML_SANCTIONS_REVIEW_THRESHOLD` | `70` | Score placed in the review band. |
| `AML_REGULATORY_REPORTING_ENABLED` | `false` | Enable the HTTP filing transport. |
| `AML_REGULATORY_REPORTING_URL` | — | Authority endpoint (secret: no). |
| `AML_REGULATORY_REPORTING_API_KEY` | — | Authority credential (secret: yes). |
| `AML_REGULATORY_REPORTING_TIMEOUT_MS` | `15000` | HTTP timeout for filings. |

---

## Admin API

All routes are version 1 under `/v1/admin/aml`, guarded by
`AuthGuard('jwt')` + `RolesGuard` with `@Roles('admin', 'company_admin')`, and
intercepted by `AuditInterceptor`.

| Group | Routes |
| --- | --- |
| Rules | `GET /rules`, `POST /rules`, `POST /rules/seed`, `PATCH /rules/:id`, `POST /rules/:id/enabled` |
| Sweeps | `POST /sweep`, `POST /users/:userId/monitor`, `GET /status` |
| Alerts | `GET /alerts`, `GET /users/:userId/alerts`, `POST /alerts/:id/triage` |
| Cases | `GET /cases`, `GET /cases/summary`, `GET /cases/overdue`, `POST /cases`, `GET /cases/:id`, `POST /cases/:id/alerts`, `PATCH /cases/:id`, `POST /cases/:id/close` |
| Sanctions | `GET /sanctions/counts`, `GET /sanctions/peps`, `POST /sanctions/entries`, `POST /sanctions/import`, `POST /sanctions/preview` |
| Screening | `POST /screening/subject`, `POST /screening/rescreen` |
| SAR | `GET /sar`, `GET /sar/analytics`, `POST /sar`, `GET /sar/:id`, `POST /sar/:id/review`, `GET /sar/:id/verify` |
| Filings | `POST /submissions`, `GET /submissions`, `GET /submissions/metrics`, `POST /submissions/:id/retry`, `POST /submissions/:id/acknowledge` |

---

## Data model

Migration `2100000000000-CreateAmlMonitoringTables.ts` creates nine tables:

| Table | Role |
| --- | --- |
| `aml_monitoring_rules` | Tunable detector configuration. |
| `aml_cases` | Unit of analyst work, timeline, SLA. |
| `aml_alerts` | Findings, deduplicated by `dedupe_key`. |
| `sanctions_list_entries` | Loaded OFAC/UN/EU and PEP entries with aliases and ID numbers. |
| `aml_screening_results` | Per-subject screening history and decision. |
| `aml_sar_reports` | Drafts, narrative, canonical hash. |
| `aml_regulatory_submissions` | Filing attempts and outcomes. |
| `aml_monitoring_runs` | Sweep coverage record. |
| `aml_disposition_feedback` | Labelled analyst outcomes feeding sensitivity. |

Pattern, status, severity and disposition values are plain `varchar` unions
mirroring `aml.constants.ts`, in the same style as the regulatory rule engine, so
adding a pattern or a disposition does not require a migration. There is
deliberately no foreign key from `aml_*` tables to `users`: monitoring rows must
outlive account deletion so a filing can still be evidenced.

---

## Testing

Unit coverage is on the decision logic, not the wiring:

* `aml-detectors.spec.ts` — window membership, thresholds, per-pattern dedupe, score clamping and rounding.
* `aml-behavioral.spec.ts` — baseline statistics, z-score anomalies, new-jurisdiction handling, option overrides.
* `aml-name-match.spec.ts` — normalisation, containment scoring, partial DOB grading.
* Service specs for rules, case, monitoring cron, transaction monitoring, sanctions list, sanctions screening, SAR generation, regulatory reporting, and the admin controller.

---

## Operational limits

* A `transaction_logs` flow has no USD amount, so on-chain-only activity cannot
  trigger `HIGH_VALUE` or `STRUCTURING`. Those patterns need the fiat-side rows.
* The jurisdiction rule ships with an empty `countries` list and therefore
  matches nothing until a deployment loads its watchlist — an empty list is
  treated as "no rule", not "match everything".
* Sanctions matching is name-and-DOB based. It is a triage aid; a person with no
  shared token in any alias is not surfaced. Blocking decisions on partial-name
  evidence alone generate the false positives the review band exists to avoid.
* Re-running a historical window after tuning parameters does not re-alert
  anything already deduplicated; delete the corresponding `aml_alerts` rows (or
  use a new rule code) if a backfill must reconsider them.
