#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config}"
NAMESPACE_MANIFESTS_DIR="${NAMESPACE_MANIFESTS_DIR:-}"
DATABASE_URL="${DATABASE_URL:-}"
DB_RESTORE_COMMAND="${DB_RESTORE_COMMAND:-}"
DB_VERIFY_QUERY="${DB_VERIFY_QUERY:-SELECT 1}"

log() {
  echo "[disaster-recovery] $*"
}

fail() {
  echo "[disaster-recovery] ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

verify_cluster_access() {
  log "Verifying cluster access and connection keys"
  [[ -f "$KUBECONFIG" ]] || fail "KUBECONFIG not found at $KUBECONFIG"

  require_command kubectl
  kubectl --kubeconfig "$KUBECONFIG" config view --minify >/dev/null
  kubectl --kubeconfig "$KUBECONFIG" get nodes >/dev/null

  log "Cluster access verified successfully"
}

reapply_namespaces() {
  if [[ -z "$NAMESPACE_MANIFESTS_DIR" ]]; then
    log "NAMESPACE_MANIFESTS_DIR is not set; skipping namespace reapply"
    return 0
  fi

  [[ -d "$NAMESPACE_MANIFESTS_DIR" ]] || fail "Namespace manifest directory not found: $NAMESPACE_MANIFESTS_DIR"

  log "Reapplying namespace configuration from $NAMESPACE_MANIFESTS_DIR"
  kubectl --kubeconfig "$KUBECONFIG" apply -f "$NAMESPACE_MANIFESTS_DIR"
}

redeploy_cluster_workloads() {
  log "Restarting cluster deployments to force node redeploys"

  mapfile -t deployments < <(kubectl --kubeconfig "$KUBECONFIG" get deployments -A -o name 2>/dev/null || true)
  if [[ ${#deployments[@]} -eq 0 ]]; then
    log "No deployments found for rollout restart"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG" rollout restart "${deployments[@]}"
  kubectl --kubeconfig "$KUBECONFIG" rollout status "${deployments[@]}" --timeout=10m
}

verify_database_restore() {
  if [[ -n "$DB_RESTORE_COMMAND" ]]; then
    log "Running database restore command"
    eval "$DB_RESTORE_COMMAND"
  fi

  if [[ -n "$DATABASE_URL" ]]; then
    if command -v psql >/dev/null 2>&1; then
      log "Verifying database connectivity with the configured restore settings"
      PGPASSWORD="${PGPASSWORD:-}" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$DB_VERIFY_QUERY" >/dev/null
      log "Database verification completed successfully"
    else
      log "psql is not available; skipping database connectivity verification"
    fi
  else
    log "DATABASE_URL is not set; skipping database connectivity verification"
  fi
}

main() {
  verify_cluster_access
  reapply_namespaces
  redeploy_cluster_workloads
  verify_database_restore

  log "Disaster recovery checklist completed"
}

main "$@"
