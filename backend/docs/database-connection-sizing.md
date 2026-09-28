# Database Connection Sizing — per-replica pool budget

Issue [#1037](https://github.com/Agri-fund/agri-fi/issues/1037)

---

## The problem

`DATABASE_POOL_MAX` and pgbouncer `pool_size` are **per-replica** settings.
Without accounting for the HPA replica ceiling, these values multiply across
pods and exhaust `max_connections` on the RDS instance:

| Before #1037         | Value  | At maxReplicas=10        |
|----------------------|--------|--------------------------|
| `pool_size` (pgbouncer) | 100 | 10 × 100 = **1000** server connections |
| `DATABASE_POOL_MAX`  | 50     | 10 × 50  = **500** TypeORM connections toward pgbouncer |
| RDS `max_connections`| 200    | **exhausted 5× over**    |

> TypeORM's `DATABASE_POOL_MAX` targets the *local pgbouncer sidecar*, not
> Postgres directly. The real Postgres exposure is controlled by pgbouncer's
> `pool_size`. Both values must be right-sized, but for different reasons.

---

## Connection flow per pod

```
NestJS (TypeORM)
    │  pool: DB_POOL_MAX=5 connections
    ▼
PgBouncer sidecar  127.0.0.1:6432   (max_client_conn=200)
    │  pool: pool_size=20 real server connections
    ▼
RDS PostgreSQL  agri-fi-postgres:5432
```

TypeORM's pool only needs to be large enough to keep PgBouncer busy — it
never opens a Postgres connection directly. PgBouncer multiplexes many
application connections into a smaller number of server connections using
transaction-mode pooling.

---

## Budget calculation

```
RDS instance class        : db.t3.small
max_connections           : 200
Reserved (ops/admin/mig.) :  30
  ├─ postgres_exporter    :   2
  ├─ migrations / psql    :   5
  ├─ read-replica repl.   :   3
  └─ headroom / DBA       :  20
─────────────────────────────
Usable budget             : 170 connections

HPA maxReplicas           :   8
pool_size per replica     :  20   (floor(170 / 8) = 21, rounded to 20)
Worst-case server conns   : 160   (8 × 20)
Safety margin             :  10   (170 − 160)
```

### Alert threshold — 85% of max_connections

```
85% × 200 = 170 connections
```

This fires exactly at the usable budget ceiling, giving on-call time to
act (scale down, kill idle-in-transaction sessions) before hard exhaustion
at 200 connections.

---

## Configured values (post-#1037)

| Setting | File | Value | Notes |
|---|---|---|---|
| `DATABASE_POOL_MIN` | `configmap.yaml` | `2` | TypeORM → pgbouncer |
| `DATABASE_POOL_MAX` | `configmap.yaml` | `5` | TypeORM → pgbouncer |
| `pool_size` (per db) | `pgbouncer-configmap.yaml`, `pgbouncer.ini` | `20` | pgbouncer → RDS |
| `default_pool_size` | `pgbouncer-configmap.yaml`, `pgbouncer.ini` | `20` | pgbouncer → RDS |
| `min_pool_size` | pgbouncer files | `2` | idle floor |
| `reserve_pool_size` | pgbouncer files | `2` | emergency slots |
| `maxReplicas` | `hpa.yaml` | `8` | **connection budget guard** |
| `minReplicas` | `hpa.yaml` | `2` | always-on floor |
| CPU scale target | `hpa.yaml` | `70%` | lowered from 80% |

---

## How to recalculate for a different RDS instance

When upgrading the RDS instance class, recalculate and update all three
files atomically — updating only one will break the budget invariant.

```
# 1. Look up new max_connections for your instance class.
#    Formula: LEAST(DBInstanceClassMemory/9531392, 5000)
#    Or query: SHOW max_connections;  on the running instance.

NEW_MAX=<rds_max_connections>
RESERVED=30
USABLE=$(( NEW_MAX - RESERVED ))

# 2. Decide new maxReplicas (HPA upper bound).
NEW_MAX_REPLICAS=<desired>

# 3. Derive pool_size (floor division, keep a ≥10 safety margin).
POOL_SIZE=$(( USABLE / NEW_MAX_REPLICAS ))
ACTUAL_CONNS=$(( POOL_SIZE * NEW_MAX_REPLICAS ))
MARGIN=$(( USABLE - ACTUAL_CONNS ))

echo "pool_size=$POOL_SIZE, worst-case=${ACTUAL_CONNS}, margin=$MARGIN"

# 4. Apply:
#    devops/k8s/pgbouncer-configmap.yaml  → pool_size, default_pool_size
#    devops/k8s/pgbouncer.ini             → pool_size, default_pool_size
#    devops/k8s/configmap.yaml            → DATABASE_POOL_MAX (keep at 5
#                                           unless TypeORM queue depth
#                                           metrics show frequent waits)
#    devops/k8s/hpa.yaml                  → maxReplicas
```

### Reference table for common RDS instance classes

| Instance      | max_connections | Usable (−30) | maxReplicas | pool_size | Worst-case |
|---------------|-----------------|--------------|-------------|-----------|------------|
| db.t3.micro   | 112             | 82           | 4           | 20        | 80         |
| db.t3.small   | 200             | 170          | **8**       | **20**    | **160** ✓  |
| db.t3.medium  | 406             | 376          | 12          | 31        | 372        |
| db.t4g.large  | 823             | 793          | 20          | 39        | 780        |
| db.r6g.large  | 1663            | 1633         | 30          | 54        | 1620       |

> The values in **bold** are the current production configuration.

---

## Prometheus alerts

Two alert groups fire on connection saturation. Both must be healthy for
the system to be considered safe.

### `agri_fi_database_pool` (postgres_exporter — RDS level)

| Alert | Threshold | Severity |
|---|---|---|
| `DatabaseConnectionSaturationWarning` | > 85% of `max_connections` | warning |
| `DatabaseConnectionSaturationCritical` | > 95% of `max_connections` | critical + PagerDuty |
| `DatabaseIdleInTransactionConnections` | > 5 idle-in-txn connections | warning |
| `DatabaseConnectionPoolExhausted` | ≥ `max_connections` | critical + PagerDuty |
| `DatabaseExporterDown` | exporter unreachable 1m | warning |

Recording rule: `agri_fi:pg_connections_pct`

### `agri_fi_pgbouncer_pool` (pgbouncer_exporter sidecar — per-pod level)

| Alert | Threshold | Severity |
|---|---|---|
| `PgBouncerServerPoolHighUsage` | > 85% of `pool_size` | warning |
| `PgBouncerServerPoolCritical` | > 95% of `pool_size` | critical + PagerDuty |
| `PgBouncerClientWaiting` | > 10 clients queued | warning |
| `PgBouncerMaxWaitHigh` | > 5s wait time | warning |
| `PgBouncerExporterDown` | exporter unreachable 1m | warning |

Recording rule: `agri_fi:pgbouncer_server_pool_pct`

The PgBouncer alerts are the **earlier signal** — they fire at the per-pod
level before aggregated RDS usage crosses the threshold. Treat a
`PgBouncerServerPoolHighUsage` alert as a pre-warning for
`DatabaseConnectionSaturationWarning`.

---

## Runbook — responding to saturation alerts

### `DatabaseConnectionSaturationWarning` or `PgBouncerServerPoolHighUsage`

```bash
# 1. Check current replica count vs. budget
kubectl get hpa agri-fi-backend -n agri-fi

# 2. Check for idle-in-transaction sessions (these waste slots)
kubectl exec -it <postgres-pod> -- psql -c "
  SELECT pid, now() - state_change AS duration, query
  FROM pg_stat_activity
  WHERE state = 'idle in transaction'
  ORDER BY duration DESC LIMIT 10;"

# 3. Check per-pod pgbouncer stats
kubectl exec -it <backend-pod> -c pgbouncer -n agri-fi -- \
  psql -p 6432 -U pgbouncer pgbouncer -c "SHOW POOLS;"

# 4. Verify pgbouncer pool_size has not drifted
kubectl exec -it <backend-pod> -c pgbouncer -n agri-fi -- \
  psql -p 6432 -U pgbouncer pgbouncer -c "SHOW DATABASES;"
```

### `DatabaseConnectionSaturationCritical` or `DatabaseConnectionPoolExhausted`

```bash
# Emergency: terminate idle-in-transaction sessions older than 30s
kubectl exec -it <postgres-pod> -- psql -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle in transaction'
    AND now() - state_change > interval '30 seconds';"

# If HPA has scaled above maxReplicas (shouldn't happen, but verify):
kubectl scale deployment agri-fi-backend-blue --replicas=8 -n agri-fi

# Reload pgbouncer config without restart (applies pool_size changes):
kubectl exec <backend-pod> -c pgbouncer -n agri-fi -- pgbouncer -R
```

---

## Files changed in #1037

| File | Change |
|---|---|
| `devops/k8s/configmap.yaml` | Added `DATABASE_POOL_MIN/MAX`, `DATABASE_POOL_*_TIMEOUT_MS`; fixed `DATABASE_NAME` to `agric_onchain` |
| `devops/k8s/pgbouncer-configmap.yaml` | `pool_size` 100→20, `default_pool_size` 100→20, `min_pool_size` 5→2, `reserve_pool_size` 5→2 |
| `devops/k8s/pgbouncer.ini` | Same as above |
| `devops/k8s/hpa.yaml` | `maxReplicas` 10→8, CPU target 80→70%, added `behavior.scaleDown` stabilisation, added budget annotation |
| `devops/prometheus/alerts.yaml` | Replaced `agri_fi_database_pool` group (fixed `datname`, metric, thresholds); added `agri_fi_pgbouncer_pool` group |
| `devops/prometheus/prometheus.yml` | Added `postgres_exporter` scrape job |
| `backend/.env.example` | `DATABASE_POOL_MIN` 5→2, `DATABASE_POOL_MAX` 50→5 with sizing comment |
