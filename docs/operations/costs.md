# Cost optimization playbook

This guide helps DevOps and platform operators find the cheapest levers to change first in the AgriFi stack. The goal is to reduce waste without slowing delivery or risking outages.

## 1. S3 lifecycle policies: move cold data off the hot tier

### Why this matters
S3 standard storage is expensive for large, infrequently accessed objects such as logs, exports, generated PDFs, and old backups. A lifecycle policy can move artifacts to cheaper storage tiers automatically.

### Cheapest first changes
1. Reduce retention on non-prod and audit buckets.
2. Move files older than 30–90 days to Intelligent-Tiering or Standard-IA.
3. Expire old temp, test, and generated artifacts after a short period.
4. Keep only the latest production snapshots; prune old backups.

### Example: move old logs and exports to cheaper storage

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket agri-fi-logs \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "Archive-logs-90d",
        "Status": "Enabled",
        "Filter": {"Prefix": "logs/"},
        "Transitions": [
          {"Days": 30, "StorageClass": "STANDARD_IA"},
          {"Days": 90, "StorageClass": "GLACIER_IR"}
        ],
        "Expiration": {"Days": 365}
      }
    ]
  }'
```

### Example: expire generated uploads and temporary files quickly

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket agri-fi-assets \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "Purge-temp-files",
        "Status": "Enabled",
        "Filter": {"Prefix": "tmp/"},
        "Expiration": {"Days": 7}
      }
    ]
  }'
```

### Expected effect
- Lower storage cost for archival and infrequent data
- Much smaller storage spend with little-to-no application change

### Gotchas
- Do not archive data that is still needed for legal or operational investigation.
- Glacier deep archive can have retrieval fees and longer access times.
- Verify bucket versioning and object-lock settings before enabling expiration.

---

## 2. RDS sizing review: right-size before adding replicas

### Why this matters
Databases are a common billing spike. A once-solid instance may be oversized after traffic settles, and overprovisioning is often more expensive than adding a tuned query index or pruning unnecessary retention.

### What to review first
1. Check CPU, memory, and I/O metrics for the last 2–4 weeks.
2. Review the largest queries and table growth.
3. Check whether read replicas or cache layers are needed instead of simply scaling up the primary.
4. Verify backup retention, storage class, and automated snapshots are not creating unnecessary storage cost.

### Commands

```bash
aws rds describe-db-instances --query "DBInstances[?DBInstanceIdentifier=='agri-fi-prod'].[DBInstanceIdentifier,DBInstanceClass,AllocatedStorage,StorageType]" --output table

aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=agri-fi-prod \
  --start-time 2026-08-01T00:00:00Z \
  --end-time 2026-09-01T00:00:00Z \
  --period 3600 \
  --statistics Average,Maximum
```

### Size-change workflow
1. Move to a smaller instance class only after confirming sustained low CPU and memory.
2. Confirm storage growth and IOPS are in the expected range.
3. Re-test under peak load before promotion to production.
4. Keep a rollback plan ready for a migration window.

### Expected effect
- Lower monthly database cost
- Better utilization of a smaller instance without sacrificing performance if the workload is light

### Gotchas
- Avoid shrinking too aggressively if the app has hidden peaks at month-end or during harvest campaigns.
- RDS storage volume and IOPS can cost more than the compute instance itself.
- Each instance class change requires downtime or a maintenance window for a major upgrade path.

---

## 3. ECS/Fargate budget alerts: catch growth before the bill lands

### Why this matters
Container workloads often grow quietly through task revisions, auto-scaling, or unplanned logging. Budget alerts help catch the drift before the charge becomes a surprise.

### Recommended setup
1. Set a monthly budget for the account or project.
2. Add an alert at 50%, 80%, and 100% of the budget.
3. Add alarms for Fargate task hours, network egress, and ALB load balancer usage.
4. Alert on ECS service scaling events and large task count jumps.

### AWS CLI examples

Create a monthly budget:

```bash
aws budgets create-budget \
  --account-id 123456789012 \
  --budget '{
    "BudgetName": "agri-fi-platform-monthly",
    "BudgetType": "COST",
    "Limit": {"Amount": "500", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "CostFilters": {"TagKey": ["Project"], "TagValues": ["agri-fi"]}
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80,
        "ThresholdType": "PERCENTAGE"
      },
      "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "devops@company.com"}]
    }
  ]'
```

Check ECS service counts and task definitions:

```bash
aws ecs describe-services --cluster agri-fi-cluster --services agri-fi-api
aws ecs describe-task-definition --task-definition agri-fi-api:latest
```

### Expected effect
- Early warning before cost spikes
- Faster response to runaway autoscaling or overprovisioned tasks

### Gotchas
- Budget alerts are notification signals, not a guardrail; you still need autoscaling policy review.
- Fargate costs are heavily affected by task count, CPU, memory, and networking.
- Watch for multiple services sharing a cluster because a single task increase can be multiplied across environments.

---

## 4. Cost anomaly notifications: detect sudden billing changes

### Why this matters
Cost anomalies are often the first clue that a queue, backup, log stream, or dev environment is no longer small and cheap.

### Setup
1. Enable billing alerts and cost anomaly detection in the AWS billing console or via CloudWatch and Budgets APIs.
2. Monitor tags such as Project, Environment, Service, and Team.
3. Alert Slack, email, or PagerDuty when anomalies exceed a threshold or a percentage change.

### Example: create an anomaly alarm through CloudWatch

```bash
aws ce put-anomaly-subscription \
  --subscription-name agri-fi-cost-anomaly \
  --threshold-expression '{
    "Dimensions": {"Key": "ANOMALY_TOTAL_COST", "Values": ["USD"]},
    "MatchOptions": ["GREATER_THAN_OR_EQUAL"],
    "ThresholdValue": 100
  }' \
  --frequency DAILY \
  --monitor-arn-list arn:aws:ce:::anomalyMonitor/your-monitor-id \
  --subscribers '[
    {"Type": "EMAIL", "Address": "devops@company.com"},
    {"Type": "SNS", "Address": "arn:aws:sns:us-east-1:123456789012:agri-fi-billing-alerts"}
  ]'
```

### Expected effect
- Faster detection of outliers and unexpected usage spikes
- Better ownership and faster remediation

### Gotchas
- Tagging must be consistent; untagged resources are harder to attribute and may not show up in filters.
- Alerts can be noisy if the threshold is too low or budgets are frequently revised.
- Cost anomalies are not a substitute for capacity forecasting or SLO-based autoscaling.

---

## Order of operations: cheapest wins first

Use this sequence to reduce spend quickly and safely:

1. Clear unused S3 data and set lifecycle rules
2. Review RDS instance class and usage patterns
3. Set ECS/Fargate budget and autoscaling guardrails
4. Turn on anomaly notifications for billing spikes
5. Revisit app-level logs and backups once early wins are in place

## Practical decision rules

- If storage is large and rarely accessed: fix S3 lifecycle first.
- If database utilization is low and stable: resize RDS next.
- If container traffic is climbing unexpectedly: fix autoscaling and budgets before changing the app.
- If billing spikes are unexplained: enable anomaly alerts with environment tags and invite the owning team.

## Final note

The least risky and most cost-effective improvements are usually operational controls: lifecycle rules, right-sizing, and budget alerts. They reduce spend quickly without changing product behavior or requiring broad application refactors.
