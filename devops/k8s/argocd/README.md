# ArgoCD App-of-Apps — agri-fi

This directory contains the full GitOps configuration for deploying the
agri-fi platform via ArgoCD. A single root **App-of-Apps** bootstraps all
workloads in dependency order using **sync waves**.

---

## Directory layout

```
devops/k8s/argocd/
├── argocd-project.yaml       # AppProject — allowed sources, destinations, RBAC
├── app-of-apps.yaml          # Root Application (bootstrap entry-point)
├── applicationset.yaml       # ApplicationSet — generates per-environment apps
├── apps/                     # Child Application manifests (sync-wave annotated)
│   ├── redis.yaml            # wave -2
│   ├── rabbitmq.yaml         # wave -1
│   ├── backend.yaml          # wave  0
│   ├── frontend.yaml         # wave  1
│   └── kustomization.yaml
└── envs/                     # Kustomize overlays per environment
    ├── staging/
    │   └── kustomization.yaml
    └── production/
        └── kustomization.yaml
```

Workload manifests live in sibling directories:

```
devops/k8s/
├── redis/          # Deployment, Service, PVC, NetworkPolicy
├── rabbitmq/       # StatefulSet, Services, ConfigMap, NetworkPolicy
├── backend/        # kustomization.yaml → backend/k8s/ in source tree
└── frontend/       # kustomization.yaml → frontend k8s manifests
```

---

## Sync wave ordering

ArgoCD processes resources in ascending wave order. Within a wave, all
resources are applied simultaneously. ArgoCD waits for every resource in
wave N to reach **Healthy** before starting wave N+1.

```
Wave -2   redis       ──►  Healthy?
                               │
Wave -1   rabbitmq   ◄─────────┘  ──►  Healthy?
                                           │
Wave  0   backend    ◄─────────────────────┘  ──►  Healthy?
                                                       │
Wave  1   frontend   ◄─────────────────────────────────┘
```

The annotation that drives this on each child Application:

```yaml
annotations:
  argocd.argoproj.io/sync-wave: "-2"   # redis
  argocd.argoproj.io/sync-wave: "-1"   # rabbitmq
  argocd.argoproj.io/sync-wave: "0"    # backend
  argocd.argoproj.io/sync-wave: "1"    # frontend
```

> **Why these numbers?**  Negative waves run first. Zero is the default
> when no annotation is present, so explicit wave 0 on backend makes it
> clear that it follows infrastructure (negative waves) but precedes UI.

---

## Bootstrap (first-time setup)

### Prerequisites

- `kubectl` connected to the target cluster
- ArgoCD installed in the `argocd` namespace
- `argocd` CLI authenticated (`argocd login <server>`)

### Steps

```bash
# 1. Apply the AppProject so ArgoCD accepts resources from this repo.
kubectl apply -f devops/k8s/argocd/argocd-project.yaml

# 2. Bootstrap the root App-of-Apps.
#    ArgoCD will discover and create all child Applications automatically.
kubectl apply -f devops/k8s/argocd/app-of-apps.yaml

# 3. (Optional) Deploy the ApplicationSet for environment-aware management.
kubectl apply -f devops/k8s/argocd/applicationset.yaml

# 4. Watch the sync progress.
argocd app list
argocd app get agri-fi-app-of-apps
```

After step 2, ArgoCD will:
1. Sync `agri-fi-app-of-apps` → creates the four child Application objects.
2. Begin wave -2: sync `agri-fi-redis`, wait for Healthy.
3. Advance to wave -1: sync `agri-fi-rabbitmq`, wait for Healthy.
4. Advance to wave 0: sync `agri-fi-backend`, wait for Healthy.
5. Advance to wave 1: sync `agri-fi-frontend`.

---

## Environment management (ApplicationSet)

The `applicationset.yaml` uses a **List generator** + **RollingSync
strategy** to gate production behind staging:

| Environment | Namespace            | selfHeal | Sync window          |
|-------------|----------------------|----------|----------------------|
| staging     | `agri-fi-staging`    | `true`   | 24 × 7               |
| production  | `agri-fi-production` | `false`  | Mon–Fri 08:00–20:00 UTC |

Adding a new environment (e.g. `preview`) requires only a new entry in the
`generators.list.elements` array and a new overlay under `envs/preview/`.

---

## syncPolicy decisions per workload

| Workload  | prune  | selfHeal | Rationale                                                   |
|-----------|--------|----------|-------------------------------------------------------------|
| redis     | `true` | `true`   | Stateless cache; safe to auto-correct drift                 |
| rabbitmq  | `true` | `true`   | Config drift on the broker is dangerous; auto-heal prevents it |
| backend   | `true` | `false`  | Blue/green slot flip is manual; ArgoCD must not revert it   |
| frontend  | `true` | `false`  | Production UI rollback should be an explicit decision       |

All apps use `ServerSideApply=true` for clean field ownership and to avoid
`last-applied-configuration` annotation bloat.

---

## Adding a new workload

1. Create `devops/k8s/<workload>/` with a `kustomization.yaml` and manifests.
2. Create `devops/k8s/argocd/apps/<workload>.yaml` — an Application manifest
   with the appropriate `sync-wave` annotation.
3. Add `<workload>.yaml` to `devops/k8s/argocd/apps/kustomization.yaml`.
4. Add namespace patches in both `envs/staging/` and `envs/production/`.
5. Open a PR — ArgoCD will pick up the new child app on the next sync of
   `agri-fi-app-of-apps`.

---

## Troubleshooting

### Sync is stuck at a wave

```bash
# See which resources are blocking the wave
argocd app get agri-fi-redis --show-operation

# Describe the unhealthy pod
kubectl describe pod -l component=redis -n agri-fi

# Force a refresh (re-evaluates health without waiting for next poll)
argocd app refresh agri-fi-redis
```

### Child app not appearing after bootstrap

```bash
# Confirm the root app-of-apps synced successfully
argocd app sync agri-fi-app-of-apps

# Check ArgoCD application controller logs
kubectl logs -n argocd -l app.kubernetes.io/component=application-controller --tail=50
```

### Out-of-sync resource in production with selfHeal=false

```bash
# Review the diff before deciding to sync
argocd app diff agri-fi-backend-production

# Manually trigger sync after review
argocd app sync agri-fi-backend-production
```

### RabbitMQ credentials secret missing

The RabbitMQ StatefulSet requires a `agri-fi-rabbitmq-credentials` Secret
with keys `username`, `password`, and `erlang-cookie`. Create it with
SealedSecrets before the first sync:

```bash
kubectl create secret generic agri-fi-rabbitmq-credentials \
  --from-literal=username=agri \
  --from-literal=password=<strong-password> \
  --from-literal=erlang-cookie=<random-64-char-string> \
  --namespace agri-fi \
  --dry-run=client -o yaml | kubeseal -o yaml \
  > devops/k8s/argocd/rabbitmq-credentials-sealed.yaml
```

---

## References

- [ArgoCD App-of-Apps pattern](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)
- [Sync waves & phases](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)
- [ApplicationSet](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/)
- [AppProject](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/)
- [Server-Side Apply](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/#server-side-apply)
