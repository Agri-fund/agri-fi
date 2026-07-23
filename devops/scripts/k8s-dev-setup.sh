#!/usr/bin/env bash
# Bootstrap a local Kubernetes development cluster using minikube.
# Deploys Postgres, RabbitMQ, and ingress for the agri-fi stack.
set -euo pipefail

MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-agri-fi-dev}"
MINIKUBE_CPUS="${MINIKUBE_CPUS:-2}"
MINIKUBE_MEMORY="${MINIKUBE_MEMORY:-4096}"
MINIKUBE_DRIVER="${MINIKUBE_DRIVER:-docker}"
K8S_MANIFESTS_DIR="$(cd "$(dirname "$0")/../k8s" && pwd)"

log() { echo "[k8s-dev-setup] $*"; }

require() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: '$1' is required but not installed." >&2
    exit 1
  fi
}

require minikube
require kubectl
require helm

# ── 1. Start minikube ────────────────────────────────────────────────────────
log "Starting minikube cluster (profile: $MINIKUBE_PROFILE)..."
minikube start \
  --profile "$MINIKUBE_PROFILE" \
  --driver "$MINIKUBE_DRIVER" \
  --cpus "$MINIKUBE_CPUS" \
  --memory "${MINIKUBE_MEMORY}mb" \
  --addons ingress,metrics-server

kubectl config use-context "$MINIKUBE_PROFILE"

# ── 2. Deploy Postgres ───────────────────────────────────────────────────────
log "Deploying Postgres..."
helm repo add bitnami https://charts.bitnami.com/bitnami --force-update >/dev/null
helm upgrade --install agri-postgres bitnami/postgresql \
  --namespace default \
  --set auth.username=agri \
  --set auth.password=agri \
  --set auth.database=agri_dev \
  --set primary.persistence.size=2Gi \
  --wait --timeout 3m

# ── 3. Deploy RabbitMQ ───────────────────────────────────────────────────────
log "Deploying RabbitMQ..."
helm upgrade --install agri-rabbitmq bitnami/rabbitmq \
  --namespace default \
  --set auth.username=agri \
  --set auth.password=agri \
  --set persistence.size=1Gi \
  --wait --timeout 3m

# ── 4. Apply k8s manifests ───────────────────────────────────────────────────
if [ -d "$K8S_MANIFESTS_DIR" ]; then
  log "Applying Kubernetes manifests from $K8S_MANIFESTS_DIR..."
  kubectl apply -f "$K8S_MANIFESTS_DIR" --recursive
else
  log "No k8s manifests directory found at $K8S_MANIFESTS_DIR — skipping."
fi

# ── 5. Apply ingress ─────────────────────────────────────────────────────────
log "Enabling and waiting for ingress controller..."
minikube addons enable ingress --profile "$MINIKUBE_PROFILE" || true
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s || log "Warning: ingress controller not ready in time."

# ── 6. Print connection info ─────────────────────────────────────────────────
MINIKUBE_IP="$(minikube ip --profile "$MINIKUBE_PROFILE")"
log "Cluster ready. Minikube IP: $MINIKUBE_IP"
log "Postgres:  postgres://agri:agri@$(kubectl get svc agri-postgres-postgresql -o jsonpath='{.spec.clusterIP}'):5432/agri_dev"
log "RabbitMQ:  amqp://agri:agri@$(kubectl get svc agri-rabbitmq -o jsonpath='{.spec.clusterIP}'):5672"
log ""
log "Add the following to /etc/hosts for ingress routing:"
log "  $MINIKUBE_IP  agri-fi.local"
