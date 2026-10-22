# GitOps Deployment Guide

AgriFi uses ArgoCD as the deployment controller and Git as the source of truth. Helm configures environment-specific application releases; Kubernetes resources are reconciled by ArgoCD.

## Prerequisites

- Kubernetes cluster with NGINX Ingress Controller and Metrics Server
- ArgoCD installed in the `argocd` namespace
- cert-manager installed with a reachable ACME solver
- External Secrets Operator or Sealed Secrets configured
- Container images published by GitHub Actions

## Repository Layout

- `devops/helm/agri-fi/Chart.yaml` - umbrella Helm chart
- `values-dev.yaml`, `values-staging.yaml`, `values-production.yaml` - environment configuration
- `templates/` - backend, frontend, ingress, HPA, PostgreSQL, Redis, and RabbitMQ resources
- `devops/k8s/argocd/app-of-apps.yaml` - root ArgoCD application
- `devops/k8s/argocd/applicationset.yaml` - staging and production environment generator
- `devops/k8s/argocd/apps/agri-fi-helm*.yaml` - Helm-backed child Applications

## Secret Management

Application secrets must be created with Sealed Secrets or External Secrets before the Helm release is synchronized. The chart references `agri-fi-backend-secrets` and never stores secret values in Git.

Required keys include:

- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`

Do not commit plaintext secret values. Rotate credentials through the secret provider and verify the rollout after reconciliation.

## Bootstrap

```bash
kubectl apply -f devops/k8s/argocd/argocd-project.yaml
kubectl apply -f devops/k8s/argocd/app-of-apps.yaml
kubectl apply -f devops/k8s/argocd/applicationset.yaml
```

ArgoCD will reconcile staging before production through the RollingSync strategy. Use the ArgoCD UI or CLI to inspect health and sync status:

```bash
argocd app get agri-fi-helm-staging
argocd app sync agri-fi-helm-staging
argocd app wait agri-fi-helm-staging --health
```

## Manual Helm Validation

```bash
helm lint devops/helm/agri-fi
helm template agri-fi devops/helm/agri-fi -f devops/helm/agri-fi/values-staging.yaml
helm template agri-fi devops/helm/agri-fi -f devops/helm/agri-fi/values-production.yaml
```

## Deploying an Image

1. CI builds and pushes backend and frontend images.
2. Update the image tags in the environment values file or the ArgoCD release parameters.
3. Commit and push the change to the configured Git branch.
4. ArgoCD detects drift, renders the Helm chart, and performs a rolling update.
5. Verify readiness probes, HPA status, ingress certificates, and application health.

## Rollback

```bash
argocd app rollback agri-fi-helm-production <history-id>
```

Alternatively, revert the image tag or manifest commit in Git and allow ArgoCD to restore the previous desired state. Do not make the production cluster the source of truth.

## Health and Scaling

Backend and frontend Deployments use rolling updates with `maxUnavailable: 0`. HPAs scale against CPU utilization, and both applications expose readiness/liveness probes. PostgreSQL, Redis, and RabbitMQ are single-instance StatefulSet/Deployment defaults; production persistence requires cluster storage classes and a managed database strategy with backups.

## Observability

Prometheus may scrape annotated application and infrastructure pods. Grafana dashboards can query backend metrics, Redis exporter metrics, RabbitMQ metrics, PostgreSQL/PgBouncer metrics, and Kubernetes HPA status. Keep scrape endpoints protected and review the existing dashboard assets under `devops/grafana/`.
