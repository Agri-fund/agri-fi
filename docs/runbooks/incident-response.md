# Incident Response Playbook

This playbook defines how Agri-Fi responds to production incidents, from first page to
blameless postmortem. It aligns incident severity with the SLO alerts defined in
[`devops/prometheus/alerts.yaml`](../../devops/prometheus/alerts.yaml) so that the on-call
engineer always knows how urgent an alert is and what to do first.

> **Why this matters:** payment settle/custody is the critical path. During payment
> incidents, delayed or unclear escalation lets small failures (a growing DLQ, a lagging
> replica) silently spread into customer-facing outages.

## At a glance

| Item | Location |
|---|---|
| Alert rules (source of truth) | `devops/prometheus/alerts.yaml` |
| Escrow runbook | [`blockchain/contracts/escrow/ESCROW_CONTRACT.md`](../../blockchain/contracts/escrow/ESCROW_CONTRACT.md) |
| Escrow queue/DLQ retry | `npm run queue:retry-dlq <main\|escrow>` (`backend/scripts/retry-dlq.ts`) |
| Database performance / indexes | [`backend/docs/database-performance.md`](../../backend/docs/database-performance.md) |
| DB backup & restore | `devops/scripts/db-backup.sh`, `backend/k8s/backup-verify-job.yaml` |
| Disaster recovery | `devops/scripts/disaster-recovery.sh`, [`docs/production-readiness.md`](../production-readiness.md) |
| On-call channel | `#stellar-alerts` |

---

## 1. Severity levels

Severity is driven by **user/business impact**, not by which component fired. When in
doubt, escalate up one level.

| Severity | Definition | Examples | Response target | Notify |
|---|---|---|---|---|
| **SEV-1** | Funds at risk, payment/custody outage, or total loss of a critical dependency. | Stellar tx failure rate >5%, all Horizon nodes down, DB pool exhausted, escrow settlement stalled, escrow DLQ stuck >1h, Redis down. | Page on-call immediately; triage within **15 min**; status update every **30 min** until mitigated. | Engineering on-call + on-call manager (full page). |
| **SEV-2** | Degraded service or loss of failover headroom; risk of SEV-1 if unaddressed. | Horizon degraded to 1 healthy node, escrow queue >500, consumers down >10m, outbox stalled, DB pool >80%, replication lag >5s. | Page on-call; triage within **1 hour**; work during business hours/handled by on-call. | Engineering on-call. |
| **SEV-3** | Early warning / capacity / observability drift with no immediate user impact. | Redis memory >80%, eviction rate elevated, exporter down, resolver lag warning, metrics endpoint unreachable. | Triage within **24 hours**; fix in normal hours. | Backend/platform team channel (no page). |

The balance-monitor urgency tiers in
[`STELLAR_MONITORING.md`](../../backend/src/stellar/STELLAR_MONITORING.md) map onto the same
scale:

- `< 10 XLM` platform balance → **SEV-1** (fund immediately)
- `< 30 XLM` → **SEV-2** (fund within 1 hour)
- `< 50 XLM` → **SEV-3** (fund within 24 hours)

---

## 2. Roles

| Role | Who | Responsibilities |
|---|---|---|
| **Controller** (incident lead) | Primary on-call engineer | Owns the incident. Declares severity, runs the timeline, calls for help, makes the go/no-go call on mitigation (e.g. `queue:retry-dlq`, failover, freeze). Never fixes code and runs comms at the same time — delegate one of them. |
| **Comms** | On-call manager or designated engineer | Posts authoritative status updates to `#incidents` / `#stellar-alerts`, manages stakeholder expectations, keeps a running status note (open / investigating / identified / monitoring / resolved). |
| **Engineering** | Pull in subject-matter experts (backend, blockchain, devops) | Diagnose and remediate. Escalate via `StellarHorizonAllNodesDown`/`DatabaseConnectionPoolExhausted` if fixes require infra or contract changes. |

**Escalation path:** Controller → on-call manager → engineering lead → platform owner.
A SEV-1 that is not mitigated within **1 hour** must escalate to the on-call manager.

---

## 3. Timeline expectations

| Phase | SEV-1 | SEV-2 | SEV-3 |
|---|---|---|---|
| Acknowledge (someone owns it) | 15 min | 1 hour | 24 hours |
| First status update | 30 min after acknowledge | within 2 hours | same business day |
| Regular status cadence | every 30 min | hourly (business hours) | as needed |
| Root-cause identified | target within 2 hours | within business day | within a week |
| Mitigation / workaround in place | target within 2 hours | within 1 business day | within a week |
| Blameless postmortem | required, within 5 business days | required if recurring/funds-related | optional |

If the incident cannot be mitigated and payment/custody is affected, the Controller must
trigger the **disaster-recovery / rollback** runbook referenced in
[`docs/ARCHIVAL_ROLLBACK.md`](../ARCHIVAL_ROLLBACK.md) and
[`docs/production-readiness.md`](../production-readiness.md).

---

## 4. SLO alert → severity mapping

All alerts below are defined in `devops/prometheus/alerts.yaml`. The mapping is
**component-based**:

- **SEV-1** = `critical` alerts on the payment/custody/outage path.
- **SEV-2** = `warning` alerts on the escrow/stellar/database path (degradation or loss of
  failover headroom).
- **SEV-3** = `warning` alerts on cache and observability.

| Alert | Group | Existing label | Mapped severity |
|---|---|---|---|
| `StellarTxFailureRate` | escrow_queue | `critical` | **SEV-1** |
| `StellarHorizonAllNodesDown` | stellar_horizon | `critical` | **SEV-1** |
| `DatabaseConnectionPoolExhausted` | database_pool | `critical` | **SEV-1** |
| `DatabasePoolCriticalUsage` | database_pool | `critical` | **SEV-1** |
| `DatabaseReplicationLagCritical` | database_replication | `critical` | **SEV-1** |
| `EscrowQueueDepthCritical` | escrow_queue | `critical` | **SEV-1** |
| `DLQNotEmpty` | escrow_queue | `critical` | **SEV-1** |
| `RedisDown` | redis_memory | `critical` | **SEV-1** |
| `RedisMemoryUsageCritical` | redis_memory | `critical` | **SEV-1** |
| `EscrowQueueDepthHigh` | escrow_queue | `warning` | **SEV-2** |
| `DLQGrowing` | escrow_queue | `warning` | **SEV-2** |
| `EscrowConsumerLag` | escrow_queue | `warning` | **SEV-2** |
| `OutboxStalledEvents` | escrow_queue | `warning` | **SEV-2** |
| `StellarHorizonDegraded` | stellar_horizon | `warning` | **SEV-2** |
| `StellarHorizonHighFailoverRate` | stellar_horizon | `warning` | **SEV-2** |
| `StellarHorizonLatencyHigh` | stellar_horizon | `warning` | **SEV-2** |
| `DatabasePoolHighUsage` | database_pool | `warning` | **SEV-2** |
| `DatabaseIdleInTransactionConnections` | database_pool | `warning` | **SEV-2** |
| `DatabaseReplicationLagHigh` | database_replication | `warning` | **SEV-2** |
| `RedisMemoryUsageHigh` | redis_memory | `warning` | **SEV-3** |
| `RedisMaxMemoryNotConfigured` | redis_memory | `warning` | **SEV-3** |
| `RedisHighEvictionRate` | redis_memory | `warning` | **SEV-3** |
| `RedisExporterDown` | redis_memory | `warning` | **SEV-3** |
| `DatabaseExporterDown` | database_pool | `warning` | **SEV-3** |
| `StellarMetricsDown` | stellar_horizon | `warning` | **SEV-3** |

A backup-restore SLO is enforced separately by `backend/k8s/backup-verify-job.yaml`
(`SLO_RESTORE_MINUTES=30`): if a restore verification exceeds 30 minutes it must be treated
as a **SEV-2** and investigated.

---

## 5. First-on-call actions

### Escrow / payment path

1. **Verify** — confirm the alert is still firing (Grafana / `kubectl get pods` / RabbitMQ
   management UI).
2. **Assess** — check queue depth (`escrow.process`) and DLQ depth (`escrow.dlq`).
3. **Remediate** —
   - DLQ backlog → inspect then requeue: `npm run queue:retry-dlq escrow --peek`, then
     `npm run queue:retry-dlq escrow`.
   - No consumers (`EscrowConsumerLag`) → restart the escrow consumer / confirm pod health.
   - Settlements failing (`StellarTxFailureRate`) → check Stellar network status, base fee,
     and contract health; escalate to blockchain SME.

### Database

1. **Verify** — pool metrics via PgBouncer exporter / `pg_stat_activity`.
2. **Assess** — `SELECT * FROM pg_stat_activity WHERE state <> 'idle';` and check replica
   lag with `SELECT now() - pg_last_xact_replay_timestamp();`.
3. **Remediate** —
   - Connection exhaustion → identify the hogging query, terminate it, scale pool/replicas.
   - Idle-in-transaction → find uncommitted transactions and roll back/fix the holder.
   - Replication lag → check replica health and restore; see `database-performance.md`.

### Cache (Redis)

1. Confirm eviction pressure; if `RedisDown`, the app falls back to in-memory cache — treat
   as SEV-1 while auth/rate-limiting is degraded.
2. Scale up Redis memory or clear the offending key growth before eviction causes session
   failures.

### Platform wallet (XLM balance)

Follow the funding tiers in section 1: fund the platform wallet and verify the next
monitor cycle clears.

---

## 6. Communication templates

**Page / initial (SEV-1):**
> `SEV-1 — <alert>` — `<one-line impact>`. Controller: `<name>`. Next update in 30 min.

**Status update:**
> `Status: <open|investigating|identified|monitoring|resolved>` — `<what changed since last
> update>`. Impact: `<who/what affected>`. Next update: `<time>`.

**Resolved:**
> `Resolved — <incident>` after `<duration>`. Impact `<summary>`. Postmortem due
> `<date>` / not required (SEV-3).

---

## 7. Blameless postmortem template

Copy into a new doc under `docs/postmortems/` and fill in after every SEV-1 (and any
recurring or funds-related SEV-2).

```
# Postmortem — <incident title>

- **Incident ID / link**:
- **Date**: YYYY-MM-DD
- **Severity**: SEV-1 / SEV-2
- **Detected by**: <alert name / person>
- **Detected at**: <UTC>
- **Resolved at**: <UTC>
- **Total impact duration**:
- **Controller / Comms**:

## Impact
- Who and what was affected (users, payments, escrow, data).

## Timeline (UTC)
| Time | Event |

## Root cause
- One or two paragraphs on what happened and why (no blame).

## What went well
-

## What went poorly
-

## Action items
| # | Action | Owner | Due |
|---|--------|-------|-----|

## Links
- Dashboards, logs, related runbooks.
```

Retrospectives must be **blameless**: focus on systems and process, not individuals; every
action item gets an owner and a due date.

---

## 8. Runbook references

### Escrow

- Contract mechanics, milestones, refunds, compliance freeze:
  [`blockchain/contracts/escrow/ESCROW_CONTRACT.md`](../../blockchain/contracts/escrow/ESCROW_CONTRACT.md)
- Queue / DLQ topology & constants: `backend/src/queue/queue.dlq.constants.ts`
- DLQ triage/retry: `npm run queue:retry-dlq <main|escrow>` — see `backend/scripts/retry-dlq.ts`

### Database

- Query/index performance: [`backend/docs/database-performance.md`](../../backend/docs/database-performance.md)
- Backup & restore verification (30-min SLO): `backend/k8s/backup-verify-job.yaml`
- Backup: `devops/scripts/db-backup.sh` · Disaster recovery: `devops/scripts/disaster-recovery.sh`
- Production readiness (failover, backup integrity): [`docs/production-readiness.md`](../production-readiness.md)

---

**Status**: Initiated for Issue #1069
**Last Updated**: 2026-09-25
**Maintainer**: Platform / DevOps Team