# Elasticsearch ILM Log Retention Policy

This document describes the Index Lifecycle Management (ILM) policy for Agri-Fi's Elasticsearch cluster, which manages 90-day hot retention with automatic archival to S3 cold storage and eventual deletion.

## Overview

The EFK stack collects logs from all backend and frontend containers via Fluentd. Without a retention policy, Elasticsearch storage grows unbounded. The ILM policy automates the lifecycle:

1. **Hot (0d)**: New indices, actively written
2. **Warm (7d)**: Reduced replicas, read-optimized
3. **Cold (30d)**: Searchable snapshots in S3
4. **Frozen (90d)**: Fully archived in S3
5. **Delete (180d)**: Removed from all storage

## Index Naming and Patterns

Fluentd writes logs with pattern: **`agri-fi-YYYY.MM.DD`**

Example:
- `agri-fi-2025-09-25` — Today's logs
- `agri-fi-2025-09-24` — Yesterday's logs

The ILM policy matches indices via the template pattern **`agri-fi-*`** and automatically applies the retention policy.

## ILM Lifecycle Phases

### Hot Phase (Days 0–1)

**Settings:**
- **Rollover trigger**: 50GB or 1 day (whichever first)
- **Replicas**: 1 (default)
- **Shards**: 1 per index
- **Priority**: 100 (highest)

**Purpose**: Accommodate real-time log ingestion. When an index reaches 50GB or 1 day old, it rolls over to a new index.

**Transition**: After 1 day, index moves to warm.

### Warm Phase (Days 7–30)

**Settings:**
- **Replicas**: 0 (no replicas, single-node cluster)
- **Shards**: Shrink to 1 per index
- **Priority**: 50

**Purpose**: Optimize read performance. Shrinking reduces overhead for historical data.

**Transition**: After 7 days, index moves to cold.

### Cold Phase (Days 30–90)

**Settings:**
- **Searchable snapshots**: Snapshot to S3, delete local copy
- **Priority**: 0 (lowest)

**Purpose**: Archive to S3 while keeping data queryable. S3 provides cheap, durable storage (STANDARD_IA).

**Transition**: After 30 days, index moves to frozen.

### Frozen Phase (Days 90–180)

**Settings:**
- **Searchable snapshots**: Full snapshot in S3
- **Data**: Not directly queryable without restore

**Purpose**: Long-term cold storage. Data is available but not searchable without explicit restore.

**Transition**: After 90 days, index marked for deletion.

### Delete Phase (Days 180+)

**Settings:**
- **Delete indices**: Permanently removed

**Purpose**: Hard boundary for log retention. Balances compliance (90+ day audit logs) with storage cost.

## S3 Storage Configuration

### Repository Details

**Name**: `s3-backup-repo`  
**S3 Bucket**: `agri-fi-elasticsearch-backups`  
**Region**: `us-east-1`  
**Base Path**: `/logs/snapshots`  
**Storage Class**: `STANDARD_IA` (Infrequent Access for cost savings)

### Repository Settings

| Setting | Value | Purpose |
|---|---|---|
| `compress` | true | Reduce snapshot size |
| `chunk_size` | 100mb | Upload parallelization |
| `server_side_encryption` | true | Encrypt at rest in S3 |
| `canned_acl` | private | Restrict S3 bucket access |
| `max_snapshot_bytes_per_sec` | 500mb | Limit ingestion impact |
| `max_restore_bytes_per_sec` | 500mb | Limit restore traffic |

### AWS Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketVersioning",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::agri-fi-elasticsearch-backups"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::agri-fi-elasticsearch-backups/*"
    }
  ]
}
```

## Setup Instructions

### Prerequisites

1. Elasticsearch 8.15.3+ running
2. S3 bucket created: `agri-fi-elasticsearch-backups`
3. AWS credentials with S3 permissions (see above)
4. `jq` and `curl` installed (for manual setup)

### Automated Setup (Kubernetes)

```bash
# 1. Apply ConfigMap with policies
kubectl apply -f devops/k8s/elasticsearch-s3-config.yaml

# 2. Create S3 credentials secret
kubectl create secret generic elasticsearch-s3-credentials \
  --from-literal=s3_access_key=$AWS_ACCESS_KEY_ID \
  --from-literal=s3_secret_key=$AWS_SECRET_ACCESS_KEY \
  -n logging

# 3. Run initialization job
kubectl apply -f devops/k8s/elasticsearch-s3-config.yaml
kubectl wait --for=condition=complete job/elasticsearch-init -n logging --timeout=5m
```

### Manual Setup (Docker/Local)

```bash
# 1. Export Elasticsearch URL
export ES_URL=http://localhost:9200

# 2. Run setup script
cd devops/efk
bash elasticsearch-setup.sh
```

## Monitoring and Alerts

### Storage Alerts

Configured in `devops/k8s/elasticsearch-storage-alert.yaml`:

| Alert | Threshold | Action |
|---|---|---|
| `ElasticsearchDiskUsageHigh` | >80% disk used | Warning: plan capacity increase |
| `ElasticsearchDiskUsageCritical` | >95% disk used | Critical: immediate action needed |
| `ElasticsearchDiskSpaceLow` | <10GB available | Warning: indices may fail to write |
| `ElasticsearchDiskFullIn7Days` | Predicted full in 7 days | Warning: increase capacity |
| `ElasticsearchDiskFullIn24Hours` | Predicted full in 24 hours | Critical: urgent action required |

### Monitoring Queries

Check ILM status:
```bash
curl http://localhost:9200/_ilm/status
# Output: {"mode":"running"}
```

Check index ILM phases:
```bash
curl http://localhost:9200/agri-fi-*/_ilm/explain | jq '.indices | to_entries[] | {index: .key, phase: .value.phase, phase_execution_ms: .value.phase_execution_ms}'
```

View S3 snapshots:
```bash
curl http://localhost:9200/_snapshot/s3-backup-repo/_all | jq '.snapshots[] | {snapshot: .snapshot, state: .state, duration: .duration_in_millis}'
```

Disk usage breakdown:
```bash
curl http://localhost:9200/_cat/indices/agri-fi-* | awk '{print $3, $6, $1}'
# Output: store.size docs.count index
```

## Troubleshooting

### ILM Policy Not Applying

**Symptom**: Indices stay in hot phase beyond 1 day.

**Cause**: ILM policy not attached to indices.

**Fix**:
```bash
curl -X PUT http://localhost:9200/agri-fi-*/_settings -H "Content-Type: application/json" -d '{
  "index.lifecycle.name": "agri-fi-logs-retention",
  "index.lifecycle.rollover_alias": "agri-fi-logs"
}'
```

### S3 Repository Not Reachable

**Symptom**: Snapshots fail; "failed to register snapshot repository"

**Cause**: Missing/incorrect AWS credentials or S3 bucket permissions.

**Fix**:
```bash
# Verify bucket exists and is accessible
aws s3 ls s3://agri-fi-elasticsearch-backups

# Re-register repository with correct credentials
curl -X DELETE http://localhost:9200/_snapshot/s3-backup-repo
curl -X PUT http://localhost:9200/_snapshot/s3-backup-repo \
  -H "Content-Type: application/json" \
  -d @devops/efk/s3-repository.json
```

### High Disk Usage Despite ILM

**Symptom**: Disk still growing; ILM phases not progressing.

**Cause**: Rollover not triggered; indices too small or new.

**Fix**:
1. Manually trigger rollover:
   ```bash
   curl -X POST http://localhost:9200/agri-fi-logs/_rollover
   ```
2. Check Fluentd buffer: may be holding logs
   ```bash
   kubectl logs -n logging daemonset/fluentd | grep "ERROR\|buffer"
   ```

### Snapshot Failures

**Symptom**: Cold phase stuck; snapshots fail

**Cause**: S3 permission denied or bucket full.

**Fix**:
```bash
# Check snapshot status
curl http://localhost:9200/_snapshot/s3-backup-repo/_status | jq .

# Review S3 bucket metrics
aws s3api head-bucket --bucket agri-fi-elasticsearch-backups

# Check CloudWatch logs for S3 errors
aws logs filter-log-events --log-group-name /aws/s3/agri-fi-elasticsearch-backups
```

## Cost Estimation

Assuming 5GB/day of logs:

- **Hot (0–1d)**: 5GB in local SSD (high cost, short duration)
- **Warm (1–7d)**: 35GB, shrunk (reduced cost)
- **Cold (7–30d)**: 115GB in S3 STANDARD_IA (~$0.03/GB/month ≈ $3.45/month)
- **Frozen (30–90d)**: 300GB in S3 GLACIER (~$0.01/GB/month ≈ $3/month)
- **Deleted (90d+)**: 0GB

**Total monthly S3 cost**: ~$6–8/month for cold/frozen logs. Local ES storage: ~50GB hot cache.

## Related Documentation

- [Elasticsearch ILM Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-lifecycle-management.html)
- [S3 Repository Documentation](https://www.elastic.co/guide/en/elasticsearch/plugins/current/repository-s3.html)
- `devops/efk/ilm-policy.json` — Policy definition
- `devops/efk/s3-repository.json` — S3 config
- `devops/k8s/elasticsearch-storage-alert.yaml` — Prometheus alerts
