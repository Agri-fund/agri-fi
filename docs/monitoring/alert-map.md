# Alert triage map

This map is the on-call quick reference for the Prometheus rules in [devops/prometheus/alerts.yaml](../../devops/prometheus/alerts.yaml). It is intentionally concise so operators can answer three questions in under a minute: what is the signal, who owns it, and what to do next.

## Ownership model

- Backend team: database saturation, connection leaks, and replica lag affecting API correctness.
- Platform team: exporter health and infrastructure monitoring availability.
- PagerDuty routing is enabled for critical severities and for sustained failures that threaten API availability.

## Alert catalog

| Alert | Metric / signal | Severity | Team | Owner | Triage step | Runbook |
| --- | --- | --- | --- | --- | --- | --- |
| DatabasePoolHighUsage | `pg_stat_activity_count{datname="agri",state!="idle"} / pg_settings_max_connections * 100` | warning | backend | backend-oncall | Check for connection leaks, long transactions, and recent deploys. Verify read/ write traffic spikes before raising to incident. | https://runbooks.internal/agri-fi/db-pool |
| DatabasePoolCriticalUsage | `pg_stat_activity_count{datname="agri",state!="idle"} / pg_settings_max_connections * 100` | critical | backend | backend-oncall | Treat as active incident. Reduce connection churn, restart stuck workers if needed, and page the backend owner immediately. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseIdleInTransactionConnections | `pg_stat_activity_count{datname="agri",state="idle in transaction"}` | warning | backend | backend-oncall | Find transactions that are stuck without commit/rollback and terminate the blocking session. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseConnectionPoolExhausted | `pg_stat_activity_count{datname="agri",state!="idle"} >= pg_settings_max_connections` | critical | backend | backend-oncall | API requests will fail immediately. Check for runaway queries, app scaling, and recent migrations. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseExporterDown | `up{job="postgres_exporter"} == 0` | warning | platform | platform-oncall | Validate exporter process, target discovery, and network path to the Postgres instance. Alerting may be partially blind until recovery. | https://runbooks.internal/agri-fi/postgres-exporter |
| DatabaseReplicationLagHigh | `pg_replication_lag_seconds` | warning | backend | backend-oncall | Confirm replica health, query load, and promotion readiness. Validate that read traffic is still safe to route. | https://runbooks.internal/agri-fi/replica-lag |
| DatabaseReplicationLagCritical | `pg_replication_lag_seconds` | critical | backend | backend-oncall | Escalate to the backend on-call, pause non-essential reads, and assess whether failover or promotion is required. | https://runbooks.internal/agri-fi/replica-lag |

## Decision guide

1. If the alert is warning and the metric is trending steadily upward, investigate the app layer before opening a major incident.
2. If the alert is critical or `pagerduty: "true"`, route directly to the owning on-call and escalate to incident response if the application is rejecting requests.
3. If the postgres exporter is down, treat alert fidelity as degraded and validate monitoring infrastructure before blaming the database itself.

## Maintenance

Update this page whenever a Prometheus rule is added, removed, or re-scoped. The owner and runbook labels in [devops/prometheus/alerts.yaml](../../devops/prometheus/alerts.yaml) should be kept in sync with this document.
