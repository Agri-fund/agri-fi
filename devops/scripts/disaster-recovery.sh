#!/usr/bin/env bash
# Multi-region disaster recovery for Agri-Fi.
set -euo pipefail

KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config}"
SECONDARY_REGION="${SECONDARY_REGION:-}"
EKS_CLUSTER_NAME="${EKS_CLUSTER_NAME:-}"
EKS_NODEGROUP_NAME="${EKS_NODEGROUP_NAME:-}"
RDS_REPLICA_ID="${RDS_REPLICA_ID:-}"
REDIS_GLOBAL_REPLICATION_GROUP_ID="${REDIS_GLOBAL_REPLICATION_GROUP_ID:-}"
REDIS_REPLICA_GROUP_ID="${REDIS_REPLICA_GROUP_ID:-}"
ROUTE53_ZONE_ID="${ROUTE53_ZONE_ID:-}"
API_RECORD_NAME="${API_RECORD_NAME:-}"
SECONDARY_API_TARGET="${SECONDARY_API_TARGET:-}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-agri-fi}"
BACKEND_CONFIGMAP="${BACKEND_CONFIGMAP:-agri-fi-backend-config}"
PRIMARY_API_HEALTH_URL="${PRIMARY_API_HEALTH_URL:-}"
HEALTH_CHECK_INTERVAL_SECONDS="${HEALTH_CHECK_INTERVAL_SECONDS:-60}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-5}"
NODEGROUP_MIN_SIZE="${NODEGROUP_MIN_SIZE:-2}"
NODEGROUP_DESIRED_SIZE="${NODEGROUP_DESIRED_SIZE:-2}"
NODEGROUP_MAX_SIZE="${NODEGROUP_MAX_SIZE:-6}"

log() {
  printf '[disaster-recovery] %s\n' "$*" >&2
}

fail() {
  printf '[disaster-recovery] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_failover_config() {
  local name
  for name in SECONDARY_REGION EKS_CLUSTER_NAME EKS_NODEGROUP_NAME RDS_REPLICA_ID \
    REDIS_GLOBAL_REPLICATION_GROUP_ID REDIS_REPLICA_GROUP_ID ROUTE53_ZONE_ID \
    API_RECORD_NAME SECONDARY_API_TARGET SNS_TOPIC_ARN; do
    [[ -n "${!name}" ]] || fail "$name must be set"
  done
  require_command aws
  require_command kubectl
  require_command jq
}

promote_database() {
  local instance
  instance="$(aws rds describe-db-instances \
    --region "$SECONDARY_REGION" \
    --db-instance-identifier "$RDS_REPLICA_ID" \
    --query 'DBInstances[0]' --output json)"

  if [[ "$(jq -r '.ReadReplicaSourceDBInstanceIdentifier // empty' <<<"$instance")" ]]; then
    log "Promoting cross-region RDS replica $RDS_REPLICA_ID"
    aws rds promote-read-replica \
      --region "$SECONDARY_REGION" \
      --db-instance-identifier "$RDS_REPLICA_ID" >/dev/null
  else
    log "RDS instance $RDS_REPLICA_ID is already promoted"
  fi

  aws rds wait db-instance-available \
    --region "$SECONDARY_REGION" \
    --db-instance-identifier "$RDS_REPLICA_ID"
  aws rds describe-db-instances \
    --region "$SECONDARY_REGION" \
    --db-instance-identifier "$RDS_REPLICA_ID" \
    --query 'DBInstances[0].Endpoint.Address' --output text
}

promote_redis() {
  local group
  group="$(aws elasticache describe-replication-groups \
    --region "$SECONDARY_REGION" \
    --replication-group-id "$REDIS_REPLICA_GROUP_ID" \
    --query 'ReplicationGroups[0]' --output json)"

  if [[ "$(jq -r '.GlobalReplicationGroupInfo.GlobalReplicationGroupId // empty' <<<"$group")" ]]; then
    log "Promoting secondary Redis replication group $REDIS_REPLICA_GROUP_ID"
    aws elasticache disassociate-global-replication-group \
      --region "$SECONDARY_REGION" \
      --global-replication-group-id "$REDIS_GLOBAL_REPLICATION_GROUP_ID" \
      --replication-group-id "$REDIS_REPLICA_GROUP_ID" \
      --retain-replication-group >/dev/null
    aws elasticache wait replication-group-available \
      --region "$SECONDARY_REGION" \
      --replication-group-id "$REDIS_REPLICA_GROUP_ID"
  else
    log "Redis replication group $REDIS_REPLICA_GROUP_ID is already detached"
  fi

  aws elasticache describe-replication-groups \
    --region "$SECONDARY_REGION" \
    --replication-group-id "$REDIS_REPLICA_GROUP_ID" \
    --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
    --output text
}

scale_standby_cluster() {
  log "Scaling EKS node group $EKS_NODEGROUP_NAME"
  aws eks update-nodegroup-config \
    --region "$SECONDARY_REGION" \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$EKS_NODEGROUP_NAME" \
    --scaling-config "minSize=$NODEGROUP_MIN_SIZE,desiredSize=$NODEGROUP_DESIRED_SIZE,maxSize=$NODEGROUP_MAX_SIZE" \
    >/dev/null
  aws eks wait nodegroup-active \
    --region "$SECONDARY_REGION" \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$EKS_NODEGROUP_NAME"
  aws eks update-kubeconfig \
    --region "$SECONDARY_REGION" \
    --name "$EKS_CLUSTER_NAME" \
    --kubeconfig "$KUBECONFIG" >/dev/null
}

update_service_config() {
  local database_endpoint redis_endpoint patch
  database_endpoint="$1"
  redis_endpoint="$2"
  patch="$(jq -cn --arg database "$database_endpoint" --arg redis "$redis_endpoint" \
    '{data:{DATABASE_HOST:$database,REDIS_HOST:$redis}}')"

  log "Updating $K8S_NAMESPACE/$BACKEND_CONFIGMAP with promoted database and Redis endpoints"
  kubectl --kubeconfig "$KUBECONFIG" -n "$K8S_NAMESPACE" \
    patch configmap "$BACKEND_CONFIGMAP" --type merge -p "$patch"
  kubectl --kubeconfig "$KUBECONFIG" -n "$K8S_NAMESPACE" \
    rollout restart deployment -l app=agri-fi-backend
  kubectl --kubeconfig "$KUBECONFIG" -n "$K8S_NAMESPACE" \
    rollout status deployment -l app=agri-fi-backend --timeout=5m
}

switch_dns() {
  local change_batch
  change_batch="$(jq -cn \
    --arg name "$API_RECORD_NAME" \
    --arg target "$SECONDARY_API_TARGET" \
    '{Comment:"Agri-Fi regional failover",Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$name,Type:"CNAME",TTL:60,ResourceRecords:[{Value:$target}]}}]}')"
  log "Pointing $API_RECORD_NAME to the secondary region"
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$ROUTE53_ZONE_ID" \
    --change-batch "$change_batch" >/dev/null
}

notify_ops() {
  local sns_region
  sns_region="$(cut -d: -f4 <<<"$SNS_TOPIC_ARN")"
  aws sns publish \
    --region "$sns_region" \
    --topic-arn "$SNS_TOPIC_ARN" \
    --subject "Agri-Fi regional failover completed" \
    --message "Failover completed. Region: $SECONDARY_REGION; database: $RDS_REPLICA_ID; API: $API_RECORD_NAME -> $SECONDARY_API_TARGET." \
    >/dev/null
}

failover() {
  local database_endpoint redis_endpoint
  require_failover_config
  log "Starting failover to $SECONDARY_REGION"
  database_endpoint="$(promote_database)"
  [[ -n "$database_endpoint" && "$database_endpoint" != "None" ]] \
    || fail "Promoted RDS endpoint was not returned"
  redis_endpoint="$(promote_redis)"
  [[ -n "$redis_endpoint" && "$redis_endpoint" != "None" ]] \
    || fail "Promoted Redis endpoint was not returned"
  scale_standby_cluster
  update_service_config "$database_endpoint" "$redis_endpoint"
  switch_dns
  notify_ops
  log "Failover procedure completed"
}

watch_primary() {
  [[ -n "$PRIMARY_API_HEALTH_URL" ]] || fail "PRIMARY_API_HEALTH_URL must be set"
  require_command curl
  require_failover_config
  [[ "$FAILURE_THRESHOLD" =~ ^[1-9][0-9]*$ ]] || fail "FAILURE_THRESHOLD must be a positive integer"
  [[ "$HEALTH_CHECK_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "HEALTH_CHECK_INTERVAL_SECONDS must be a positive integer"

  local failures=0
  log "Watching $PRIMARY_API_HEALTH_URL; failover after $FAILURE_THRESHOLD consecutive failures"
  while true; do
    sleep "$HEALTH_CHECK_INTERVAL_SECONDS"
    if curl --fail --silent --show-error --max-time 15 "$PRIMARY_API_HEALTH_URL" >/dev/null; then
      failures=0
      continue
    fi

    failures=$((failures + 1))
    log "Primary health check failed ($failures/$FAILURE_THRESHOLD)"
    if (( failures >= FAILURE_THRESHOLD )); then
      failover
      return
    fi
  done
}

recover_workloads() {
  [[ -f "$KUBECONFIG" ]] || fail "KUBECONFIG not found at $KUBECONFIG"
  require_command kubectl
  kubectl --kubeconfig "$KUBECONFIG" get nodes >/dev/null
  kubectl --kubeconfig "$KUBECONFIG" rollout restart deployment -A
  kubectl --kubeconfig "$KUBECONFIG" rollout status deployment -A --timeout=10m
  log "Workload recovery completed"
}

case "${1:-failover}" in
  failover) failover ;;
  watch) watch_primary ;;
  recover) recover_workloads ;;
  *) fail "Usage: $0 {failover|watch|recover}" ;;
esac