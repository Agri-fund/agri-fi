# Blue-Green Deployment

This document describes the blue-green deployment system for Agri-Fi, covering infrastructure layout, traffic shifting, health checks, automated rollback, canary deployments, monitoring, and analytics.

---

## Table of Contents

1. [Overview](#overview)
2. [Infrastructure](#infrastructure)
3. [Deployment Flow](#deployment-flow)
4. [Canary Deployments](#canary-deployments)
5. [Health Checks and Smoke Tests](#health-checks-and-smoke-tests)
6. [Automated Rollback](#automated-rollback)
7. [Deployment Monitoring](#deployment-monitoring)
8. [Deployment Analytics](#deployment-analytics)
9. [CI/CD Integration](#cicd-integration)
10. [Runbook: Manual Operations](#runbook-manual-operations)
11. [Architecture Decision Record](#architecture-decision-record)

---

## Overview

Blue-green deployment keeps two identical production environments (called **slots**) running at all times. Only one slot serves live traffic at any moment. Releasing a new version means deploying it to the idle slot, verifying it, then atomically flipping the Kubernetes Service selector. If anything goes wrong, flipping the selector back restores the previous version in under a second.

**Key properties:**

| Property | Value |
|---|---|
| Zero-downtime releases | ✅ Service selector flip is atomic |
| Rollback time | < 1 second (selector patch) |
| Canary support | ✅ Gradual weight increase via NGINX annotations |
| Automated rollback trigger | Error rate > 1 % or p95 latency > 500 ms |
| Deployment slots | `blue`, `green` |
| Active slot store | `agri-fi-backend` Service `.spec.selector.slot` |

---

## Infrastructure

### Kubernetes resources

```
devops/k8s/
├── backend/
│   └── kustomization.yaml          # ArgoCD entry-point for backend resources
└── blue-green/
    ├── kustomization.yaml          # Blue-green supporting resources
    ├── health-checks.yaml          # PodDisruptionBudgets + slot-internal Services
    ├── canary-ingress.yaml         # Canary Ingress + canary Service
    └── deployment-analytics.yaml  # Analytics ConfigMap, RBAC, recorder CronJob

backend/k8s/
├── deployment.yaml   # agri-fi-backend-blue + agri-fi-backend-green Deployments
└── service.yaml      # agri-fi-backend Service (selector.slot flipped at deploy time)
```

### Two identical Deployments

`backend/k8s/deployment.yaml` defines two Deployments that are structurally identical except for the `slot` label:

- **`agri-fi-backend-blue`** — `labels: slot: blue`
- **`agri-fi-backend-green`** — `labels: slot: green`

Both include a PgBouncer connection-pooling sidecar and a `pgbouncer-exporter` Prometheus sidecar.

### Service selector

```yaml
# backend/k8s/service.yaml
spec:
  selector:
    app: agri-fi-backend
    slot: blue   # ← patched to "green" or "blue" at deploy time
```

Changing the `slot` selector value is the only action needed to shift 100 % of traffic from one slot to the other.

### Slot-internal Services (health checks)

`devops/k8s/blue-green/health-checks.yaml` creates two permanent ClusterIP Services:

- `agri-fi-backend-blue-internal` → selects `slot: blue`
- `agri-fi-backend-green-internal` → selects `slot: green`

Health-check and smoke-test Jobs connect to these Services directly, so they target a specific slot regardless of which one is currently active.

### PodDisruptionBudgets

Both slots have a PDB with `minAvailable: 1`. This prevents node evictions from taking down all replicas of an idle slot while a health-check Job is probing it.

---

## Deployment Flow

```
┌──────────┐    ┌────────────────────────────────────────────────────────────────┐
│  CI/CD   │    │  Kubernetes Cluster                                             │
│          │    │                                                                 │
│  1. Build│    │  agri-fi-backend-blue   (slot: blue)   ← active (serving)      │
│  2. Push │    │  agri-fi-backend-green  (slot: green)  ← idle (scaled to 0)    │
│          │    │                                                                 │
│  3. Set  │───▶│  Scale green to 2 replicas                                     │
│  image   │    │  kubectl set image deployment/agri-fi-backend-green ...        │
│          │    │  kubectl rollout status deployment/agri-fi-backend-green       │
│  4. Health    │                                                                 │
│  check   │───▶│  curl agri-fi-backend-green-internal/health  (must return 200) │
│          │    │                                                                 │
│  5. Smoke│───▶│  Smoke-test Job: /health, /v1/trade-deals, /v1/prices/*, /metrics │
│  tests   │    │                                                                 │
│  6. Flip │───▶│  kubectl patch svc agri-fi-backend -p '{"spec":{"selector":{"slot":"green"}}}' │
│  selector│    │  ↑ atomic; zero-downtime                                        │
│          │    │                                                                 │
│  7. Watch│───▶│  Monitor error rate + p95 latency for 2 minutes                │
│          │    │                                                                 │
│  8. Wait │───▶│  Blue slot stays at 2 replicas for 5-minute rollback window    │
│          │    │                                                                 │
│  9. Scale│───▶│  kubectl scale deployment/agri-fi-backend-blue --replicas=0    │
│  down    │    │                                                                 │
└──────────┘    └────────────────────────────────────────────────────────────────┘
```

**On next deploy**, green is active and the new version goes to blue — the two slots alternate.

---

## Canary Deployments

A canary release routes a subset of live traffic to the new slot before fully promoting it. This is implemented with the NGINX Ingress Controller's weighted canary annotations.

### How it works

1. The new version is deployed to the inactive slot.
2. Smoke tests pass on the inactive slot via the internal Service.
3. The deploy script creates `agri-fi-backend-canary` Ingress pointing at the inactive slot with `canary-weight: 10`.
4. The script progressively increases the weight (default: 10 → 25 → 50 → 75 → 100 %), pausing at each step to check SLIs.
5. At 100 % the main Service selector is flipped and the canary Ingress is deleted.

### Canary Ingress annotations

```yaml
# devops/k8s/blue-green/canary-ingress.yaml
nginx.ingress.kubernetes.io/canary: "true"
nginx.ingress.kubernetes.io/canary-weight: "10"       # updated progressively
nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
nginx.ingress.kubernetes.io/canary-by-header-value: "always"  # QA bypass
nginx.ingress.kubernetes.io/canary-by-cookie: "canary_session" # session stickiness
```

- Setting `X-Canary: always` on a request always routes it to the canary slot, regardless of weight. Use this to manually test the new version.
- Once a user is routed to the canary via cookie stickiness, their session stays on the canary for consistency.

### Triggering a canary deployment

Via GitHub Actions:

```
Actions → Blue-Green Deploy → Run workflow
  environment: production
  canary: true
  canary_steps: 10,25,50,75,100
  canary_interval: 120
```

Via the deploy script:

```bash
./devops/scripts/blue-green-deploy.sh \
  --image ghcr.io/agri-fund/agri-fi/backend:abc123 \
  --namespace agri-fi \
  --canary \
  --canary-steps 10,25,50,75,100 \
  --canary-interval 120
```

---

## Health Checks and Smoke Tests

### Kubernetes readiness probes

Both slot Deployments configure readiness and liveness probes on `/health` (port `http`, which maps to container port 3001). Kubernetes will not route traffic to a pod until the readiness probe passes.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 15
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 30
  periodSeconds: 20
```

### Pre-promotion smoke tests

Before the Service selector is flipped, the CI pipeline runs a smoke-test Job against the new slot's internal Service:

| Endpoint | Assertion |
|---|---|
| `GET /health` | HTTP 200, retried 10 times |
| `GET /v1/trade-deals` | HTTP 200 (non-empty response) |
| `GET /v1/prices/commodities` | HTTP 200 |
| `GET /v1/prices/fx` | HTTP 200 |
| `GET /metrics` | HTTP 200 (Prometheus scrape target reachable) |

A single failure causes the deployment to abort. The new slot is scaled back to 0 and the rollback notification is sent.

### Post-promotion SLI monitoring

After flipping the Service selector the pipeline monitors the new active slot for 2 minutes:

- **Error rate**: HTTP 5xx / total × 100 — threshold 1 %
- **p95 latency**: 95th-percentile request duration — threshold 500 ms

A breach triggers an automated rollback (see below).

---

## Automated Rollback

### Trigger conditions

Rollback is triggered automatically when:

1. **Rollout fails** — `kubectl rollout status` returns non-zero (image pull failure, crashloopbackoff, etc.)
2. **Smoke tests fail** — any of the five endpoints returns a non-200 status
3. **Post-promotion SLI breach** — error rate > 1 % or p95 > 500 ms within 2 minutes of promotion

### Rollback mechanism

```bash
# 1. Restore previous slot to 2 replicas
kubectl -n agri-fi scale deployment/agri-fi-backend-${PREVIOUS} --replicas=2

# 2. Flip service selector back (< 1 second downtime window)
kubectl -n agri-fi patch svc agri-fi-backend \
  -p '{"spec":{"selector":{"slot":"${PREVIOUS}"}}}'

# 3. Scale down failed slot
kubectl -n agri-fi scale deployment/agri-fi-backend-${FAILED} --replicas=0
```

Rollback is also available as a standalone GitHub Actions job (`rollback` in `blue-green-deploy.yml`) that runs automatically when any upstream job fails, and can be triggered manually.

### Manual rollback

```bash
# Determine which slot is currently active
kubectl -n agri-fi get svc agri-fi-backend -o jsonpath='{.spec.selector.slot}'

# Flip back to the other slot (e.g. from green back to blue)
kubectl -n agri-fi patch svc agri-fi-backend \
  -p '{"spec":{"selector":{"slot":"blue"}}}'

# Confirm
kubectl -n agri-fi get endpoints agri-fi-backend
```

---

## Deployment Monitoring

### Grafana dashboard

**Dashboard**: [Blue-Green Deployment Monitoring](../../../devops/grafana/dashboards/blue-green-deployments.json)
**UID**: `agri-fi-blue-green`

Panels:

| Panel | Description |
|---|---|
| Active Slot | Which slot is currently serving traffic |
| HTTP Error Rate by Slot | 5xx rate per slot over time — threshold lines at 0.5 % and 1 % |
| p95 Latency by Slot | 95th-percentile latency per slot — threshold lines at 300 ms and 500 ms |
| Request Rate by Slot | Total req/s per slot — shows traffic split during canary |
| Canary Traffic Split % | Percentage of traffic to the canary slot via the canary ingress |
| Deployment Replica Count | Available replicas per slot |
| Deployment Analytics | Success vs rollback vs failure pie chart |
| Deployment Success Rate (7d) | Percentage of deployments that succeeded |
| MTTR | Mean time to rollback (minutes) |
| Deployment Events Timeline | Log stream from the analytics recorder |
| PgBouncer Pool by Slot | Active database connections per slot |
| Health Check Probe Status | Kubernetes readiness probe pass/fail per slot |
| Active Blue-Green Alerts | Firing Prometheus alerts labelled `component=blue-green` |

### Prometheus alert rules

New alert group `agri_fi_blue_green_deployment` in `devops/prometheus/alerts.yaml`:

| Alert | Condition | Severity |
|---|---|---|
| `BlueGreenHighErrorRate` | 5xx rate > 1 % for 1 min | critical |
| `BlueGreenLatencyRegression` | p95 > 500 ms for 2 min | warning |
| `BlueGreenBothSlotsActive` | Both slots receiving traffic for > 1 min | warning |
| `BlueGreenInactiveSlotNotScaledDown` | Inactive slot > 0 replicas for 10 min | warning |
| `BlueGreenCanaryStuck` | Canary ingress exists but traffic unchanged for 15 min | warning |

---

## Deployment Analytics

### Storage

Deployment outcomes are written to the `deployment-analytics` ConfigMap in the `agri-fi` namespace by the `deployment-analytics-recorder` CronJob. Each record is a JSON object:

```json
{
  "timestamp": "2025-01-15T14:32:01Z",
  "active_slot": "green",
  "outcome": "success",
  "error_rate_pct": "0.12",
  "p95_latency_ms": "187.3",
  "image": "ghcr.io/agri-fund/agri-fi/backend:abc123def",
  "environment": "production",
  "run_id": "12345678"
}
```

`outcome` is one of:
- `success` — deployment completed and traffic was promoted
- `rollback` — automated rollback was triggered
- `failure` — deployment was aborted before traffic was switched
- `degraded` — deployment succeeded but SLIs were elevated (warning only)

The ConfigMap retains the last 500 records (rolling window). For higher volume, replace the ConfigMap with a Postgres table or InfluxDB.

### Querying analytics

```bash
# View all records
kubectl -n agri-fi get cm deployment-analytics -o jsonpath='{.data.records}' | python3 -m json.tool

# Count outcomes (last 500 deployments)
kubectl -n agri-fi get cm deployment-analytics -o jsonpath='{.data.records}' | \
  python3 -c "
import json, sys, collections
records = json.load(sys.stdin)
outcomes = collections.Counter(r['outcome'] for r in records)
for k, v in outcomes.items():
    print(f'{k}: {v}')
"
```

---

## CI/CD Integration

### Workflow: `blue-green-deploy.yml`

Located at `.github/workflows/blue-green-deploy.yml`. Can be triggered:

- **Manually** via `workflow_dispatch` with `environment`, `canary`, and `image_tag` inputs
- **Programmatically** via `workflow_call` from `cd.yml`

#### Jobs

```
prepare
  └─► slot-detection
        └─► deploy-inactive
              └─► health-check
                    └─► smoke-tests
                          ├─► canary-shift  (if canary=true)
                          └─► promote       (after canary-shift or directly)
              [any failure]
              └─► rollback
```

### Workflow: `cd.yml` integration

The existing `cd.yml` runs on every push to `main` and handles staging deployments. It includes inline blue-green logic (slot detection, smoke tests, rollback job). For production, trigger `blue-green-deploy.yml` manually with `environment: production`.

### Deploy script

`devops/scripts/blue-green-deploy.sh` can be used for local or scripted deployments outside GitHub Actions.

```bash
# Standard blue-green (instant flip)
./devops/scripts/blue-green-deploy.sh \
  --image ghcr.io/agri-fund/agri-fi/backend:abc123 \
  --namespace agri-fi

# Canary with custom steps
./devops/scripts/blue-green-deploy.sh \
  --image ghcr.io/agri-fund/agri-fi/backend:abc123 \
  --namespace agri-fi \
  --canary \
  --canary-steps 5,20,50,100 \
  --canary-interval 60

# Dry run (prints actions, makes no changes)
./devops/scripts/blue-green-deploy.sh \
  --image ghcr.io/agri-fund/agri-fi/backend:abc123 \
  --dry-run
```

---

## Runbook: Manual Operations

### Check active slot

```bash
kubectl -n agri-fi get svc agri-fi-backend \
  -o jsonpath='Active slot: {.spec.selector.slot}{"\n"}'
```

### Manually switch slot

```bash
# Switch to green
kubectl -n agri-fi patch svc agri-fi-backend \
  -p '{"spec":{"selector":{"slot":"green"}}}'

# Switch to blue
kubectl -n agri-fi patch svc agri-fi-backend \
  -p '{"spec":{"selector":{"slot":"blue"}}}'
```

### Scale a slot up or down

```bash
kubectl -n agri-fi scale deployment/agri-fi-backend-blue --replicas=2
kubectl -n agri-fi scale deployment/agri-fi-backend-green --replicas=0
```

### Check slot health directly

```bash
# Port-forward the internal service for a slot
kubectl -n agri-fi port-forward svc/agri-fi-backend-blue-internal 8080:80

# In another terminal
curl http://localhost:8080/health
```

### Force remove a stuck canary

```bash
kubectl -n agri-fi delete ingress agri-fi-backend-canary --ignore-not-found
kubectl -n agri-fi delete svc agri-fi-backend-canary-svc --ignore-not-found
```

### View deployment analytics

```bash
kubectl -n agri-fi get cm deployment-analytics \
  -o jsonpath='{.data.records}' | python3 -m json.tool | tail -40
```

---

## Architecture Decision Record

### Why blue-green instead of rolling updates?

Rolling updates replace pods one at a time within the same Deployment. During the rollout both old and new pod versions co-exist, which means:

- Requests may be served by either version — problematic if the API contract changed
- Rollback requires a second rolling update, taking 60–180 s depending on replica count
- Database migrations that are not backward-compatible can break the old pods

Blue-green eliminates all three problems. The switch is atomic (Service selector patch), rollback takes under a second (re-patch), and both slots share the same database so migrations can be verified against the new slot before any traffic touches it.

### Why not Argo Rollouts or Flagger?

Both tools are well-designed, but they add an operator dependency to the cluster. The team already has ArgoCD and kubectl-based CI/CD. The custom implementation here uses no additional cluster operators, is easy to audit, and can be maintained entirely in the existing shell script and GitHub Actions workflow. If traffic-shaping requirements become more complex (e.g. Istio-based weighted routing, A/B testing), migrating to Argo Rollouts is straightforward — the slot-label convention and Service selector pattern are compatible.

### Canary vs instant flip

By default deployments use an instant selector flip. The 5-minute rollback window (old slot stays at 2 replicas) provides a manual escape hatch. Canary mode is opt-in for use cases where:

- The change is high-risk (new data processing logic, auth changes)
- Gradual rollout is required for observability (compare error rates between old and new version side-by-side)
- Stakeholders want a subset of users to validate the new version before full rollout
