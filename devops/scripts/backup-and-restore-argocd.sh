#!/usr/bin/env bash
# ArgoCD backup/restore helper with a read-only SealedSecret drift check.
#
# Examples:
#   ./devops/scripts/backup-and-restore-argocd.sh backup
#   ./devops/scripts/backup-and-restore-argocd.sh restore
#   ./devops/scripts/backup-and-restore-argocd.sh drift-check

set -euo pipefail

ACTION="${1:-backup}"
shift || true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/.artifacts/argocd-backups}"
mkdir -p "$BACKUP_DIR"

backup_argocd() {
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local dir="$BACKUP_DIR/$timestamp"
  mkdir -p "$dir"

  kubectl get ns argocd -o yaml > "$dir/ns-argocd.yaml" 2>/dev/null || true
  kubectl get secret -n argocd -o yaml > "$dir/secrets.yaml" 2>/dev/null || true
  kubectl get sealedsecret -A -o yaml > "$dir/sealedsecrets.yaml" 2>/dev/null || true
  kubectl get applications -A -o yaml > "$dir/applications.yaml" 2>/dev/null || true
  kubectl get pod -n argocd -o yaml > "$dir/pods.yaml" 2>/dev/null || true

  echo "ArgoCD backup captured at $dir"
}

restore_argocd() {
  local latest backup_path
  latest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
  if [[ -z "$latest" ]]; then
    echo "No ArgoCD backup directory found under $BACKUP_DIR" >&2
    exit 1
  fi
  backup_path="$latest"
  echo "Restoring ArgoCD state from $backup_path"
  kubectl apply -f "$backup_path"/applications.yaml || true
  kubectl apply -f "$backup_path"/ns-argocd.yaml || true
  kubectl apply -f "$backup_path"/secrets.yaml || true
  kubectl apply -f "$backup_path"/sealedsecrets.yaml || true
}

drift_check() {
  local script_path="$ROOT_DIR/devops/scripts/sealed-secret-drift-check.sh"
  if [[ ! -x "$script_path" ]]; then
    chmod +x "$script_path"
  fi
  exec "$script_path" "$@"
}

case "$ACTION" in
  backup)
    backup_argocd
    ;;
  restore)
    restore_argocd
    ;;
  drift-check)
    drift_check "$@"
    ;;
  help|-h|--help)
    cat <<'EOF'
Usage: backup-and-restore-argocd.sh [backup|restore|drift-check]

Commands:
  backup       Capture a snapshot of ArgoCD namespace, apps, secrets, and SealedSecrets.
  restore      Restore the latest backup snapshot (best-effort; review before apply).
  drift-check  Run the SealedSecret drift detection script without modifying cluster state.
EOF
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
 esac
