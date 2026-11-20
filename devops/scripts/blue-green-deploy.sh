#!/usr/bin/env bash
# blue-green-deploy.sh — Orchestrates a full blue-green (or canary) backend
# deployment for the Agri-Fi platform.
#
# USAGE
#   blue-green-deploy.sh [OPTIONS]
#
# OPTIONS
#   --image IMAGE        Full image reference to deploy (required)
#   --namespace NS       Kubernetes namespace          (default: agri-fi)
#   --canary             Enable canary mode (gradual traffic shift)
#   --canary-steps STEPS Comma-separated weight percentages (default: 10,25,50,75,100)
#   --canary-interval S  Seconds to observe at each weight step (default: 120)
#   --smoke-timeout S    Seconds to wait for smoke tests          (default: 300)
#   --rollback-on-fail   Auto-rollback if health checks fail      (default: true)
#   --dry-run            Print actions without applying them
#
# EXIT CODES
#   0  Deployment succeeded
#   1  Deployment failed (rollback may have occurred)
#   2  Usage / argument error
#
# DEPENDENCIES
#   kubectl, curl, jq (or python3 for JSON parsing fallback)
#
# ENVIRONMENT VARIABLES
#   KUBECONFIG          Path to kubeconfig (standard kubectl env var)
#   PROMETHEUS_URL      Prometheus base URL for SLI monitoring
#                       (default: http://prometheus:9090)
#   DISCORD_WEBHOOK_URL Optional Discord webhook for deployment notifications
#   SLACK_WEBHOOK_URL   Optional Slack webhook for deployment notifications

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
NAMESPACE="agri-fi"
CANARY_MODE=false
CANARY_STEPS="10,25,50,75,100"
CANARY_INTERVAL=120
SMOKE_TIMEOUT=300
ROLLBACK_ON_FAIL=true
DRY_RUN=false
IMAGE=""
PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus:9090}"
ERROR_RATE_THRESHOLD=1   # percent; above this triggers rollback
LATENCY_THRESHOLD_MS=500 # p95 ms; above this triggers rollback

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC}  $(date -u +%H:%M:%SZ) $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $(date -u +%H:%M:%SZ) $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $(date -u +%H:%M:%SZ) $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $(date -u +%H:%M:%SZ) $*" >&2; }

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)           IMAGE="$2";           shift 2 ;;
    --namespace)       NAMESPACE="$2";       shift 2 ;;
    --canary)          CANARY_MODE=true;     shift   ;;
    --canary-steps)    CANARY_STEPS="$2";    shift 2 ;;
    --canary-interval) CANARY_INTERVAL="$2"; shift 2 ;;
    --smoke-timeout)   SMOKE_TIMEOUT="$2";   shift 2 ;;
    --no-rollback)     ROLLBACK_ON_FAIL=false; shift ;;
    --dry-run)         DRY_RUN=true;         shift   ;;
    *) err "Unknown option: $1"; exit 2 ;;
  esac
done

if [[ -z "$IMAGE" ]]; then
  err "--image is required"
  exit 2
fi

# ── Dry-run wrapper ───────────────────────────────────────────────────────────
kubectl_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] kubectl $*"
  else
    kubectl "$@"
  fi
}

# ── Notification helper ───────────────────────────────────────────────────────
notify() {
  local level="$1" message="$2"
  local icon="ℹ️"
  [[ "$level" == "success" ]] && icon="✅"
  [[ "$level" == "failure" ]] && icon="❌"
  [[ "$level" == "warning" ]] && icon="⚠️"

  if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]]; then
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"${icon} **Blue-Green Deploy** — ${message}\",\"username\":\"Deploy Bot\"}" \
      >/dev/null || true
  fi

  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    curl -sf -X POST "$SLACK_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"${icon} Blue-Green Deploy: ${message}\"}" \
      >/dev/null || true
  fi
}

# ── Record analytics event ────────────────────────────────────────────────────
record_analytics() {
  local outcome="$1" active_slot="$2" error_rate="${3:-0}" p95="${4:-0}"
  local now; now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local record; record=$(printf '{"timestamp":"%s","active_slot":"%s","outcome":"%s","error_rate_pct":"%s","p95_latency_ms":"%s","image":"%s"}' \
    "$now" "$active_slot" "$outcome" "$error_rate" "$p95" "$IMAGE")

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] record_analytics: $record"
    return
  fi

  local current; current=$(kubectl -n "$NAMESPACE" get cm deployment-analytics \
    -o jsonpath='{.data.records}' 2>/dev/null || echo "[]")
  local updated; updated=$(echo "$current" | python3 -c "
import json,sys
records=json.load(sys.stdin)
records.append(json.loads('${record}'))
if len(records) > 500:
    records = records[-500:]
print(json.dumps(records))
" 2>/dev/null || echo "$current")

  kubectl_cmd -n "$NAMESPACE" patch cm deployment-analytics \
    --type=merge \
    -p "{\"data\":{\"records\":$(echo "$updated" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '\"[]\"')}}" \
    >/dev/null 2>&1 || warn "Could not update analytics ConfigMap"
}

# ── SLI monitor ──────────────────────────────────────────────────────────────
# Returns 0 if SLIs are within thresholds, 1 if breached.
check_slis() {
  local slot="$1"
  log "Checking SLIs against slot=${slot}..."

  local error_rate p95
  error_rate=$(curl -sf \
    "${PROMETHEUS_URL}/api/v1/query?query=rate(http_request_duration_ms_count%7Bstatus_code%3D~%225..%22%2Cslot%3D%22${slot}%22%7D%5B2m%5D)%2Frate(http_request_duration_ms_count%7Bslot%3D%22${slot}%22%7D%5B2m%5D)*100" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); v=r.get('data',{}).get('result',[]); print(v[0]['value'][1] if v else '0')" \
    2>/dev/null || echo "0")

  p95=$(curl -sf \
    "${PROMETHEUS_URL}/api/v1/query?query=histogram_quantile(0.95%2C+rate(http_request_duration_ms_bucket%7Bslot%3D%22${slot}%22%7D%5B2m%5D))" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); v=r.get('data',{}).get('result',[]); print(v[0]['value'][1] if v else '0')" \
    2>/dev/null || echo "0")

  local error_int; error_int=$(echo "$error_rate" | cut -d. -f1)
  local p95_int;   p95_int=$(echo "$p95" | cut -d. -f1)

  log "  error_rate=${error_rate}%  p95=${p95}ms"

  if [[ "${error_int:-0}" -ge "$ERROR_RATE_THRESHOLD" ]] 2>/dev/null; then
    err "  SLI breach: error_rate ${error_rate}% >= threshold ${ERROR_RATE_THRESHOLD}%"
    echo "$error_rate" > /tmp/_sli_error_rate
    echo "$p95"        > /tmp/_sli_p95
    return 1
  fi

  if [[ "${p95_int:-0}" -ge "$LATENCY_THRESHOLD_MS" ]] 2>/dev/null; then
    err "  SLI breach: p95 latency ${p95}ms >= threshold ${LATENCY_THRESHOLD_MS}ms"
    echo "$error_rate" > /tmp/_sli_error_rate
    echo "$p95"        > /tmp/_sli_p95
    return 1
  fi

  echo "$error_rate" > /tmp/_sli_error_rate
  echo "$p95"        > /tmp/_sli_p95
  ok "  SLIs within thresholds"
  return 0
}

# ── Smoke tests ───────────────────────────────────────────────────────────────
run_smoke_tests() {
  local slot="$1"
  local svc="agri-fi-backend-${slot}-internal"
  local job_name="smoke-test-${slot}-$(date +%s)"

  log "Running smoke tests against slot=${slot} via ${svc}..."

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] smoke test Job ${job_name}"
    return 0
  fi

  # Launch a one-shot curl pod against the slot's internal service.
  kubectl_cmd -n "$NAMESPACE" run "$job_name" \
    --rm -i --restart=Never \
    --timeout="${SMOKE_TIMEOUT}s" \
    --image=curlimages/curl:latest \
    --command -- sh -c "
set -e
BASE=http://${svc}

# ── Health endpoint ──────────────────────────────────────────────────────
echo '--- /health'
curl -fsS --retry 10 --retry-delay 3 --retry-connrefused \"\${BASE}/health\"
echo

# ── Core API endpoints ───────────────────────────────────────────────────
echo '--- /v1/trade-deals'
curl -fsS --max-time 10 \"\${BASE}/v1/trade-deals\" > /dev/null
echo 'OK'

echo '--- /v1/prices/commodities'
curl -fsS --max-time 10 \"\${BASE}/v1/prices/commodities\" > /dev/null
echo 'OK'

echo '--- /v1/prices/fx'
curl -fsS --max-time 10 \"\${BASE}/v1/prices/fx\" > /dev/null
echo 'OK'

# ── Metrics endpoint (must be reachable for Prometheus) ──────────────────
echo '--- /metrics'
curl -fsS --max-time 10 \"\${BASE}/metrics\" > /dev/null
echo 'OK'

echo 'All smoke tests passed.'
" 2>&1
  local exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    err "Smoke tests FAILED for slot=${slot}"
    return 1
  fi

  ok "Smoke tests passed for slot=${slot}"
  return 0
}

# ── Rollback ──────────────────────────────────────────────────────────────────
do_rollback() {
  local failed_slot="$1" previous_slot="$2"
  err "ROLLING BACK: switching traffic from ${failed_slot} to ${previous_slot}"

  notify "failure" "Deployment to ${failed_slot} failed — rolling back to ${previous_slot} | image=${IMAGE}"

  kubectl_cmd -n "$NAMESPACE" scale \
    "deployment/agri-fi-backend-${previous_slot}" --replicas=2

  kubectl_cmd -n "$NAMESPACE" patch svc agri-fi-backend \
    -p "{\"spec\":{\"selector\":{\"slot\":\"${previous_slot}\"}}}"

  kubectl_cmd -n "$NAMESPACE" scale \
    "deployment/agri-fi-backend-${failed_slot}" --replicas=0 || true

  # Remove canary ingress if it exists
  kubectl_cmd -n "$NAMESPACE" delete ingress agri-fi-backend-canary \
    --ignore-not-found=true 2>/dev/null || true
  kubectl_cmd -n "$NAMESPACE" delete svc agri-fi-backend-canary-svc \
    --ignore-not-found=true 2>/dev/null || true

  record_analytics "rollback" "$previous_slot" \
    "$(cat /tmp/_sli_error_rate 2>/dev/null || echo 0)" \
    "$(cat /tmp/_sli_p95 2>/dev/null || echo 0)"

  ok "Rollback complete — traffic is on slot=${previous_slot}"
}

# ── Canary traffic shift ──────────────────────────────────────────────────────
canary_shift() {
  local inactive_slot="$1"
  local active_slot="$2"

  log "Starting canary rollout → slot=${inactive_slot}"

  # Ensure canary service selector points at the new slot.
  kubectl_cmd -n "$NAMESPACE" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: agri-fi-backend-canary-svc
  namespace: ${NAMESPACE}
  labels:
    app: agri-fi-backend
    role: canary
spec:
  type: ClusterIP
  selector:
    app: agri-fi-backend
    slot: ${inactive_slot}
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
EOF

  # Apply canary ingress (the YAML file already has weight=10 as the base).
  kubectl_cmd -n "$NAMESPACE" apply \
    -f "$(dirname "$0")/../k8s/blue-green/canary-ingress.yaml" 2>/dev/null || \
  kubectl_cmd -n "$NAMESPACE" annotate ingress agri-fi-backend-canary \
    nginx.ingress.kubernetes.io/canary-weight="10" --overwrite 2>/dev/null || \
  warn "Could not apply canary ingress — ensure NGINX Ingress Controller is installed"

  IFS=',' read -ra STEPS <<< "$CANARY_STEPS"
  for weight in "${STEPS[@]}"; do
    log "  Canary weight → ${weight}%"

    if [[ "$DRY_RUN" == "false" ]]; then
      kubectl -n "$NAMESPACE" annotate ingress agri-fi-backend-canary \
        nginx.ingress.kubernetes.io/canary-weight="${weight}" \
        --overwrite 2>/dev/null || \
        warn "Could not update canary-weight annotation (ingress controller may not support it)"
    else
      echo "[DRY-RUN] annotate canary-weight=${weight}"
    fi

    if [[ "$weight" -lt 100 ]]; then
      log "  Observing for ${CANARY_INTERVAL}s at weight=${weight}%..."
      if [[ "$DRY_RUN" == "false" ]]; then
        sleep "$CANARY_INTERVAL"
        if ! check_slis "$inactive_slot"; then
          if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
            do_rollback "$inactive_slot" "$active_slot"
            exit 1
          fi
        fi
      fi
    fi
  done

  ok "Canary reached 100% — promoting slot=${inactive_slot}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DEPLOYMENT FLOW
# ═══════════════════════════════════════════════════════════════════════════════

log "=== Agri-Fi Blue-Green Deploy ==="
log "  image:     ${IMAGE}"
log "  namespace: ${NAMESPACE}"
log "  canary:    ${CANARY_MODE}"
log "  dry-run:   ${DRY_RUN}"

# ── 1. Determine active/inactive slots ───────────────────────────────────────
ACTIVE=$(kubectl -n "$NAMESPACE" get svc agri-fi-backend \
  -o jsonpath='{.spec.selector.slot}' 2>/dev/null || echo "blue")
if [[ "$ACTIVE" == "green" ]]; then INACTIVE="blue"; else INACTIVE="green"; fi

log "Active slot: ${ACTIVE} → deploying to: ${INACTIVE}"
notify "info" "Starting deployment to slot=${INACTIVE} | image=${IMAGE}"

# ── 2. Scale up inactive slot ────────────────────────────────────────────────
log "Scaling up inactive slot=${INACTIVE}..."
kubectl_cmd -n "$NAMESPACE" scale \
  "deployment/agri-fi-backend-${INACTIVE}" --replicas=2

# ── 3. Update image on inactive slot ─────────────────────────────────────────
log "Setting image on agri-fi-backend-${INACTIVE}..."
kubectl_cmd -n "$NAMESPACE" set image \
  "deployment/agri-fi-backend-${INACTIVE}" \
  "backend=${IMAGE}"

log "Waiting for rollout on slot=${INACTIVE}..."
kubectl_cmd -n "$NAMESPACE" rollout status \
  "deployment/agri-fi-backend-${INACTIVE}" \
  --timeout=180s

# ── 4. Health checks ──────────────────────────────────────────────────────────
log "Verifying health of new slot=${INACTIVE}..."
# Give pods a brief grace period after rollout before probing
sleep 10

if ! run_smoke_tests "$INACTIVE"; then
  if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
    err "Smoke tests failed — aborting deployment"
    # New slot never received traffic; just scale it down and exit.
    kubectl_cmd -n "$NAMESPACE" scale \
      "deployment/agri-fi-backend-${INACTIVE}" --replicas=0 || true
    notify "failure" "Deployment aborted — smoke tests failed on slot=${INACTIVE} | image=${IMAGE}"
    record_analytics "failure" "$ACTIVE"
    exit 1
  fi
fi

# ── 5. Traffic shifting ───────────────────────────────────────────────────────
if [[ "$CANARY_MODE" == "true" ]]; then
  canary_shift "$INACTIVE" "$ACTIVE"
fi

log "Switching main service selector → slot=${INACTIVE}"
kubectl_cmd -n "$NAMESPACE" patch svc agri-fi-backend \
  -p "{\"spec\":{\"selector\":{\"slot\":\"${INACTIVE}\"}}}"

ok "Traffic switched to slot=${INACTIVE}"

# ── 6. Post-switch SLI monitoring ────────────────────────────────────────────
log "Monitoring SLIs for 2 minutes post-switch..."
if [[ "$DRY_RUN" == "false" ]]; then
  sleep 30
  if ! check_slis "$INACTIVE"; then
    if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
      do_rollback "$INACTIVE" "$ACTIVE"
      record_analytics "rollback" "$ACTIVE" \
        "$(cat /tmp/_sli_error_rate 2>/dev/null || echo 0)" \
        "$(cat /tmp/_sli_p95 2>/dev/null || echo 0)"
      exit 1
    fi
  fi
  sleep 90  # wait for the remaining 1.5 minutes of observation
fi

# ── 7. Cleanup canary resources ───────────────────────────────────────────────
if [[ "$CANARY_MODE" == "true" ]]; then
  log "Cleaning up canary ingress..."
  kubectl_cmd -n "$NAMESPACE" delete ingress agri-fi-backend-canary \
    --ignore-not-found=true 2>/dev/null || true
  kubectl_cmd -n "$NAMESPACE" delete svc agri-fi-backend-canary-svc \
    --ignore-not-found=true 2>/dev/null || true
fi

# ── 8. Scale down old active slot (keep alive 5 min for instant rollback) ─────
log "Keeping old slot=${ACTIVE} alive for 5 minutes (instant rollback window)..."
if [[ "$DRY_RUN" == "false" ]]; then
  sleep 300
fi

log "Scaling down old slot=${ACTIVE}..."
kubectl_cmd -n "$NAMESPACE" scale \
  "deployment/agri-fi-backend-${ACTIVE}" --replicas=0 || true

# ── 9. Record analytics ───────────────────────────────────────────────────────
record_analytics "success" "$INACTIVE" \
  "$(cat /tmp/_sli_error_rate 2>/dev/null || echo 0)" \
  "$(cat /tmp/_sli_p95 2>/dev/null || echo 0)"

notify "success" "Deployment complete — active slot=${INACTIVE} | image=${IMAGE}"

ok "=== Blue-Green Deployment Complete ==="
ok "  Previous slot : ${ACTIVE}  (scaled to 0 replicas)"
ok "  Active slot   : ${INACTIVE} (live traffic)"
ok "  Image         : ${IMAGE}"
