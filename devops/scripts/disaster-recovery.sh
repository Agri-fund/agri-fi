#!/usr/bin/env bash
# disaster-recovery.sh — automated multi-region failover for Agri-Fi (#903)
# RTO target: < 15 minutes
# RPO target: < 1 minute (via RDS read replica)
#
# Usage:
#   ./disaster-recovery.sh failover   # trigger failover to secondary region
#   ./disaster-recovery.sh failback   # restore primary region
#   ./disaster-recovery.sh status     # check DR status
#   ./disaster-recovery.sh drill      # run quarterly DR drill (dry-run)
#
# ─────────────────────────────────────────────────────────────────────────────
# Blue-green rollback (#836):
#   The backend runs as two slots — agri-fi-backend-blue and
#   agri-fi-backend-green. Traffic is routed to the active slot by the
#   `slot` selector on the agri-fi-backend Service.
#
#   Instant rollback to a known-good slot:
#     1. kubectl -n default scale deployment/agri-fi-backend-<good-slot> --replicas=2
#     2. kubectl -n default patch svc agri-fi-backend \
#          -p '{"spec":{"selector":{"slot":"<good-slot>"}}}'
#     3. Optionally remove the bad slot:
#        kubectl -n default scale deployment/agri-fi-backend-<bad-slot> --replicas=0
#
#   The CD pipeline (`.github/workflows/cd.yml`) performs the same steps
#   automatically in its `rollback` job when a deploy or smoke test fails.
#   Note: the backend HPA (devops/k8s/hpa.yaml) scales the active slot only.
# ─────────────────────────────────────────────────────────────────────────────
#
# Environment variables required for multi-region failover:
#   PRIMARY_REGION            AWS region of the active primary stack
#   SECONDARY_REGION          AWS region of the warm standby
#   PRIMARY_RDS_IDENTIFIER    Primary RDS DB instance identifier
#   SECONDARY_RDS_IDENTIFIER  Secondary RDS read replica identifier
#   SECONDARY_ECS_CLUSTER     ECS cluster name in secondary region
#   BACKEND_SERVICE_NAME      ECS service name to scale on failover
#   ROUTE53_ZONE_ID           Route53 hosted zone ID
#   FAILOVER_RECORD_NAME      DNS name of the failover A record
#   ROUTE53_HEALTH_CHECK_ID   Route53 health check ID for the primary
#   SECONDARY_HEALTH_URL      URL to verify secondary is serving traffic
#   K8S_NAMESPACE             (optional) Kubernetes namespace for db-config update
#   ALERT_WEBHOOK_URL         Discord/Slack incoming webhook URL
#   AWS_PROFILE               (optional) Named AWS CLI profile
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
PRIMARY_REGION="${PRIMARY_REGION:-us-east-1}"
SECONDARY_REGION="${SECONDARY_REGION:-us-west-2}"
PRIMARY_RDS_IDENTIFIER="${PRIMARY_RDS_IDENTIFIER:-}"
SECONDARY_RDS_IDENTIFIER="${SECONDARY_RDS_IDENTIFIER:-}"
SECONDARY_ECS_CLUSTER="${SECONDARY_ECS_CLUSTER:-}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-agri-fi-backend-secondary}"
ROUTE53_ZONE_ID="${ROUTE53_ZONE_ID:-}"
FAILOVER_RECORD_NAME="${FAILOVER_RECORD_NAME:-}"
ROUTE53_HEALTH_CHECK_ID="${ROUTE53_HEALTH_CHECK_ID:-}"
SECONDARY_HEALTH_URL="${SECONDARY_HEALTH_URL:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
AWS_PROFILE="${AWS_PROFILE:-}"
DRY_RUN="${DRY_RUN:-false}"

# K8s blue-green legacy variables
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config}"
NAMESPACE_MANIFESTS_DIR="${NAMESPACE_MANIFESTS_DIR:-}"
DATABASE_URL="${DATABASE_URL:-}"
DB_RESTORE_COMMAND="${DB_RESTORE_COMMAND:-}"
DB_VERIFY_QUERY="${DB_VERIFY_QUERY:-SELECT 1}"

# AWS CLI optional profile flag
AWS_PROFILE_FLAG=""
[[ -n "$AWS_PROFILE" ]] && AWS_PROFILE_FLAG="--profile ${AWS_PROFILE}"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — SHARED HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [disaster-recovery] $*"
}

warn() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [disaster-recovery] WARN: $*" >&2
}

fail() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [disaster-recovery] ERROR: $*" >&2
  send_alert "FAILURE: disaster-recovery.sh — $*" || true
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

# Wrap aws CLI calls so dry-run mode prints rather than executes
aws_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] aws $*"
    return 0
  fi
  # shellcheck disable=SC2086
  aws $AWS_PROFILE_FLAG "$@"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — ALERTING
# ═══════════════════════════════════════════════════════════════════════════════

# send_alert MESSAGE
# Posts a plain-text message to the configured Discord/Slack webhook.
send_alert() {
  local message="$1"
  if [[ -z "$ALERT_WEBHOOK_URL" ]]; then
    warn "ALERT_WEBHOOK_URL not set — skipping alert: ${message}"
    return 0
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] send_alert: ${message}"
    return 0
  fi
  local payload
  payload=$(printf '{"content": "%s"}' "$(echo "$message" | sed 's/"/\\"/g')")
  curl --silent --fail --max-time 10 \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$ALERT_WEBHOOK_URL" >/dev/null || warn "Alert webhook delivery failed"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — MULTI-REGION FAILOVER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

# check_primary_health
# Returns 0 if the primary is healthy, 1 if it is unhealthy or unknown.
check_primary_health() {
  if [[ -z "$ROUTE53_HEALTH_CHECK_ID" ]]; then
    warn "ROUTE53_HEALTH_CHECK_ID not set; skipping health check — assuming unhealthy"
    return 1
  fi

  log "Querying Route53 health check status for: ${ROUTE53_HEALTH_CHECK_ID}"
  local status
  status=$(aws_cmd route53 get-health-check-status \
    --health-check-id "$ROUTE53_HEALTH_CHECK_ID" \
    --query 'HealthCheckObservations[0].StatusReport.Status' \
    --output text 2>/dev/null || echo "UNKNOWN")

  log "Primary health check status: ${status}"

  if echo "$status" | grep -qi "Success"; then
    return 0
  else
    return 1
  fi
}

# promote_rds_replica
# Promotes the secondary RDS read replica to a standalone primary.
# Waits up to 10 minutes for the instance to become available.
promote_rds_replica() {
  log "Promoting secondary RDS replica: ${SECONDARY_RDS_IDENTIFIER} in ${SECONDARY_REGION}"

  aws_cmd rds promote-read-replica \
    --db-instance-identifier "$SECONDARY_RDS_IDENTIFIER" \
    --region "$SECONDARY_REGION"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Skipping wait for RDS promotion"
    return 0
  fi

  log "Waiting for secondary RDS instance to become available (max 10 min)…"
  local elapsed=0
  local interval=30
  local max_wait=600

  while [[ $elapsed -lt $max_wait ]]; do
    local db_status
    db_status=$(aws_cmd rds describe-db-instances \
      --db-instance-identifier "$SECONDARY_RDS_IDENTIFIER" \
      --region "$SECONDARY_REGION" \
      --query 'DBInstances[0].DBInstanceStatus' \
      --output text 2>/dev/null || echo "unknown")

    log "RDS status: ${db_status} (${elapsed}s elapsed)"

    if [[ "$db_status" == "available" ]]; then
      log "Secondary RDS instance is available"
      return 0
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  fail "Timed out waiting for secondary RDS promotion after ${max_wait}s"
}

# scale_up_ecs
# Scales the secondary ECS service to 2 tasks and waits for stability.
scale_up_ecs() {
  log "Scaling up ECS service: ${BACKEND_SERVICE_NAME} on cluster ${SECONDARY_ECS_CLUSTER} in ${SECONDARY_REGION}"

  aws_cmd ecs update-service \
    --cluster "$SECONDARY_ECS_CLUSTER" \
    --service "$BACKEND_SERVICE_NAME" \
    --desired-count 2 \
    --region "$SECONDARY_REGION"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Skipping wait for ECS service stability"
    return 0
  fi

  log "Waiting for ECS service to reach steady state…"
  aws_cmd ecs wait services-stable \
    --cluster "$SECONDARY_ECS_CLUSTER" \
    --services "$BACKEND_SERVICE_NAME" \
    --region "$SECONDARY_REGION" \
    || fail "ECS service did not reach steady state within the wait limit"

  log "ECS service is stable"
}

# scale_down_ecs
# Scales the secondary ECS service back to 0 during failback.
scale_down_ecs() {
  log "Scaling down ECS service: ${BACKEND_SERVICE_NAME} in ${SECONDARY_REGION}"

  aws_cmd ecs update-service \
    --cluster "$SECONDARY_ECS_CLUSTER" \
    --service "$BACKEND_SERVICE_NAME" \
    --desired-count 0 \
    --region "$SECONDARY_REGION"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Skipping ECS drain wait"
    return 0
  fi

  log "Waiting for ECS service to drain…"
  aws_cmd ecs wait services-stable \
    --cluster "$SECONDARY_ECS_CLUSTER" \
    --services "$BACKEND_SERVICE_NAME" \
    --region "$SECONDARY_REGION" \
    || warn "ECS service drain wait timed out (tasks may still be stopping)"
}

# update_dns_to_secondary
# Updates the Route53 failover record weights so the SECONDARY record
# serves traffic. This is advisory — Route53 health-check-based failover
# triggers automatically, but we also adjust weights explicitly.
update_dns_to_secondary() {
  if [[ -z "$ROUTE53_ZONE_ID" || -z "$FAILOVER_RECORD_NAME" ]]; then
    warn "ROUTE53_ZONE_ID or FAILOVER_RECORD_NAME not set — skipping DNS update"
    return 0
  fi

  log "Disabling primary Route53 health check to force traffic to secondary…"

  # Mark the primary health check as disabled so Route53 failover fires immediately
  aws_cmd route53 update-health-check \
    --health-check-id "$ROUTE53_HEALTH_CHECK_ID" \
    --disabled

  log "Route53 failover: primary health check disabled — secondary record will now serve traffic"
}

# update_dns_to_primary
# Re-enables the primary Route53 health check during failback.
update_dns_to_primary() {
  if [[ -z "$ROUTE53_HEALTH_CHECK_ID" ]]; then
    warn "ROUTE53_HEALTH_CHECK_ID not set — skipping DNS restore"
    return 0
  fi

  log "Re-enabling primary Route53 health check to restore traffic to primary…"

  aws_cmd route53 update-health-check \
    --health-check-id "$ROUTE53_HEALTH_CHECK_ID" \
    --no-disabled

  log "Route53 health check re-enabled — primary will resume traffic once healthy"
}

# update_k8s_configmap
# If K8S_NAMESPACE is set, updates the db-config ConfigMap with the
# secondary RDS endpoint so any K8s workloads use the promoted replica.
update_k8s_configmap() {
  if [[ -z "$K8S_NAMESPACE" ]]; then
    log "K8S_NAMESPACE not set — skipping Kubernetes ConfigMap update"
    return 0
  fi

  require_command kubectl

  log "Fetching secondary RDS endpoint…"
  local secondary_endpoint
  if [[ "$DRY_RUN" == "true" ]]; then
    secondary_endpoint="secondary-rds-dry-run.example.us-west-2.rds.amazonaws.com"
  else
    secondary_endpoint=$(aws_cmd rds describe-db-instances \
      --db-instance-identifier "$SECONDARY_RDS_IDENTIFIER" \
      --region "$SECONDARY_REGION" \
      --query 'DBInstances[0].Endpoint.Address' \
      --output text)
  fi

  log "Updating db-config ConfigMap in namespace ${K8S_NAMESPACE} → ${secondary_endpoint}"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] kubectl -n ${K8S_NAMESPACE} patch configmap db-config -p '{\"data\":{\"DATABASE_HOST\":\"${secondary_endpoint}\"}}'"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG" \
    -n "$K8S_NAMESPACE" \
    patch configmap db-config \
    -p "{\"data\":{\"DATABASE_HOST\":\"${secondary_endpoint}\"}}" \
    || warn "kubectl patch configmap failed — update manually if needed"

  log "db-config ConfigMap updated with secondary RDS endpoint"
}

# verify_secondary_health
# Curls the secondary service health endpoint to confirm it is responding.
verify_secondary_health() {
  if [[ -z "$SECONDARY_HEALTH_URL" ]]; then
    warn "SECONDARY_HEALTH_URL not set — skipping secondary health verification"
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] curl --silent --fail --max-time 15 ${SECONDARY_HEALTH_URL}"
    return 0
  fi

  log "Verifying secondary service at: ${SECONDARY_HEALTH_URL}"
  local attempt=1
  local max_attempts=10

  while [[ $attempt -le $max_attempts ]]; do
    if curl --silent --fail --max-time 15 "$SECONDARY_HEALTH_URL" >/dev/null 2>&1; then
      log "Secondary service is healthy (attempt ${attempt})"
      return 0
    fi
    log "Health check attempt ${attempt}/${max_attempts} failed — retrying in 15s…"
    sleep 15
    attempt=$((attempt + 1))
  done

  fail "Secondary service failed to respond after ${max_attempts} attempts"
}

# record_failover_time START_TIME
# Calculates and logs total elapsed wall-clock time from START_TIME.
record_failover_time() {
  local start_time="$1"
  local end_time
  end_time=$(date +%s)
  local elapsed=$(( end_time - start_time ))
  local minutes=$(( elapsed / 60 ))
  local seconds=$(( elapsed % 60 ))

  log "Failover completed in ${minutes}m ${seconds}s (RTO target: < 15 min)"

  if [[ $elapsed -gt 900 ]]; then
    warn "RTO target MISSED: failover took ${minutes}m ${seconds}s (> 15 min)"
    send_alert "WARN: Agri-Fi DR failover completed but RTO target missed: ${minutes}m ${seconds}s"
  else
    log "RTO target MET"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — TOP-LEVEL COMMANDS
# ═══════════════════════════════════════════════════════════════════════════════

# cmd_failover
# Orchestrates: validate → check primary unhealthy → promote RDS →
# scale ECS → update DNS → update K8s configmap → verify secondary →
# alert ops → record elapsed time
cmd_failover() {
  local start_time
  start_time=$(date +%s)

  log "══════════════════════════════════════════════"
  log " STARTING MULTI-REGION FAILOVER"
  log " Primary:   ${PRIMARY_REGION}"
  log " Secondary: ${SECONDARY_REGION}"
  log " DRY_RUN:   ${DRY_RUN}"
  log "══════════════════════════════════════════════"

  # Pre-flight checks
  require_command aws
  [[ -z "$SECONDARY_RDS_IDENTIFIER" ]]  && fail "SECONDARY_RDS_IDENTIFIER is not set"
  [[ -z "$SECONDARY_ECS_CLUSTER" ]]     && fail "SECONDARY_ECS_CLUSTER is not set"

  send_alert "STARTING: Agri-Fi multi-region failover — primary=${PRIMARY_REGION} secondary=${SECONDARY_REGION}"

  # Step 1: Confirm primary is actually down (safety gate — skip in drill)
  if [[ "$DRY_RUN" != "true" ]]; then
    if check_primary_health; then
      warn "Primary health check is reporting HEALTHY. Proceeding with forced failover anyway (manual invocation)."
      send_alert "WARN: Agri-Fi failover invoked but primary health check is healthy — proceeding as manual override"
    else
      log "Primary health check confirmed UNHEALTHY — proceeding with failover"
    fi
  fi

  # Step 2: Promote secondary RDS read replica
  log "Step 2/6: Promoting secondary RDS read replica…"
  promote_rds_replica

  # Step 3: Scale up secondary ECS service
  log "Step 3/6: Scaling up secondary ECS service…"
  scale_up_ecs

  # Step 4: Update Route53 to direct traffic to secondary
  log "Step 4/6: Updating Route53 DNS failover…"
  update_dns_to_secondary

  # Step 5: Update K8s ConfigMap (if applicable)
  log "Step 5/6: Updating Kubernetes ConfigMap…"
  update_k8s_configmap

  # Step 6: Verify secondary is serving traffic
  log "Step 6/6: Verifying secondary service health…"
  verify_secondary_health

  record_failover_time "$start_time"
  send_alert "SUCCESS: Agri-Fi is now running on secondary region (${SECONDARY_REGION})"
  log "Failover complete. Monitor secondary at: ${SECONDARY_HEALTH_URL:-<SECONDARY_HEALTH_URL not set>}"
}

# cmd_failback
# Reverses failover: scale down secondary ECS → restore DNS to primary →
# note that RDS resync requires manual steps (new replica creation).
cmd_failback() {
  log "══════════════════════════════════════════════"
  log " STARTING FAILBACK TO PRIMARY REGION"
  log " Primary:   ${PRIMARY_REGION}"
  log " Secondary: ${SECONDARY_REGION}"
  log "══════════════════════════════════════════════"

  require_command aws

  send_alert "STARTING: Agri-Fi failback to primary region (${PRIMARY_REGION})"

  # Step 1: Scale down secondary ECS service
  log "Step 1/3: Scaling down secondary ECS service…"
  scale_down_ecs

  # Step 2: Re-enable primary Route53 health check
  log "Step 2/3: Restoring Route53 DNS to primary…"
  update_dns_to_primary

  # Step 3: Resync / recreate primary RDS
  # After promotion the old read replica is now a standalone instance.
  # Recreating the replica from the (now-primary) secondary requires
  # running `terraform apply` to update replicate_source_db. This step
  # documents that requirement and alerts ops.
  log "Step 3/3: Noting RDS resync requirement…"
  log "────────────────────────────────────────────────────────────"
  log "MANUAL ACTION REQUIRED: The secondary RDS instance was promoted"
  log "to standalone during failover. To re-establish replication, run:"
  log "  terraform apply -var='dr_enabled=true' in devops/terraform/"
  log "This will destroy and recreate the replica from the current primary."
  log "────────────────────────────────────────────────────────────"

  send_alert "ACTION REQUIRED: Agri-Fi failback complete but RDS replica must be rebuilt — see disaster-recovery.sh logs"
  log "Failback to primary complete"
}

# cmd_status
# Displays current DR state: Route53 health check, RDS state, ECS service.
cmd_status() {
  log "══════════════════════════════════════════════"
  log " DR STATUS CHECK"
  log "══════════════════════════════════════════════"

  require_command aws

  # Route53 health check
  if [[ -n "$ROUTE53_HEALTH_CHECK_ID" ]]; then
    log "── Route53 Health Check (${ROUTE53_HEALTH_CHECK_ID}) ──"
    aws_cmd route53 get-health-check-status \
      --health-check-id "$ROUTE53_HEALTH_CHECK_ID" \
      --query 'HealthCheckObservations[*].{Region:Region,Status:StatusReport.Status}' \
      --output table || warn "Could not retrieve health check status"
  else
    warn "ROUTE53_HEALTH_CHECK_ID not set"
  fi

  # RDS state
  if [[ -n "$PRIMARY_RDS_IDENTIFIER" ]]; then
    log "── Primary RDS (${PRIMARY_RDS_IDENTIFIER} @ ${PRIMARY_REGION}) ──"
    aws_cmd rds describe-db-instances \
      --db-instance-identifier "$PRIMARY_RDS_IDENTIFIER" \
      --region "$PRIMARY_REGION" \
      --query 'DBInstances[0].{Status:DBInstanceStatus,MultiAZ:MultiAZ,ReplicaMode:ReplicaMode}' \
      --output table || warn "Could not retrieve primary RDS status"
  fi

  if [[ -n "$SECONDARY_RDS_IDENTIFIER" ]]; then
    log "── Secondary RDS (${SECONDARY_RDS_IDENTIFIER} @ ${SECONDARY_REGION}) ──"
    aws_cmd rds describe-db-instances \
      --db-instance-identifier "$SECONDARY_RDS_IDENTIFIER" \
      --region "$SECONDARY_REGION" \
      --query 'DBInstances[0].{Status:DBInstanceStatus,ReadReplicaOf:ReadReplicaSourceDBInstanceIdentifier,Lag:PendingModifiedValues}' \
      --output table || warn "Could not retrieve secondary RDS status"
  fi

  # ECS service state
  if [[ -n "$SECONDARY_ECS_CLUSTER" && -n "$BACKEND_SERVICE_NAME" ]]; then
    log "── Secondary ECS Service (${BACKEND_SERVICE_NAME}) ──"
    aws_cmd ecs describe-services \
      --cluster "$SECONDARY_ECS_CLUSTER" \
      --services "$BACKEND_SERVICE_NAME" \
      --region "$SECONDARY_REGION" \
      --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount}' \
      --output table || warn "Could not retrieve ECS service status"
  fi

  log "Status check complete"
}

# cmd_drill
# Runs all failover steps with DRY_RUN=true — echoes commands without executing.
# Safe to run against production; no AWS resources are modified.
cmd_drill() {
  log "══════════════════════════════════════════════"
  log " DR DRILL (DRY RUN — no changes will be made)"
  log "══════════════════════════════════════════════"
  DRY_RUN=true
  cmd_failover
  log "══════════════════════════════════════════════"
  log " DR DRILL COMPLETE"
  log " Review the output above to verify all steps"
  log " would succeed. Schedule next drill in 90 days."
  log "══════════════════════════════════════════════"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — LEGACY K8s BLUE-GREEN ROLLBACK FUNCTIONS (preserved from #836)
# ═══════════════════════════════════════════════════════════════════════════════

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

# cmd_k8s_rollback — original blue-green K8s cluster recovery (from #836)
cmd_k8s_rollback() {
  verify_cluster_access
  reapply_namespaces
  redeploy_cluster_workloads
  verify_database_restore

  log "Disaster recovery checklist completed"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════════

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  failover      Trigger automated multi-region failover to secondary region
  failback      Restore traffic routing back to primary region
  status        Show current DR status (Route53, RDS, ECS)
  drill         Run a quarterly DR drill in dry-run mode (no changes made)
  k8s-rollback  Run legacy K8s blue-green cluster recovery (#836)

Environment variables — see script header for full list.
EOF
}

main() {
  local cmd="${1:-}"

  case "$cmd" in
    failover)
      cmd_failover
      ;;
    failback)
      cmd_failback
      ;;
    status)
      cmd_status
      ;;
    drill)
      cmd_drill
      ;;
    k8s-rollback)
      # Legacy entry point preserved from #836 — K8s blue-green rollback
      cmd_k8s_rollback
      ;;
    "")
      usage
      exit 1
      ;;
    *)
      echo "Unknown command: ${cmd}" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
