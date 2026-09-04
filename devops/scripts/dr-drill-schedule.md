# Agri-Fi Disaster Recovery Drill Schedule & Runbook

> Issue: #903 | RTO target: < 15 minutes | RPO target: < 1 minute

---

## Quarterly Drill Calendar

| Quarter | Scheduled Date | Lead Engineer | Status |
|---------|---------------|---------------|--------|
| Q1      | Second Tuesday of January, 09:00 UTC | On-call lead | — |
| Q2      | Second Tuesday of April, 09:00 UTC   | On-call lead | — |
| Q3      | Second Tuesday of July, 09:00 UTC    | On-call lead | — |
| Q4      | Second Tuesday of October, 09:00 UTC | On-call lead | — |

Drills run during low-traffic windows (09:00–11:00 UTC on a weekday). The
on-call engineer owns execution; a second engineer witnesses and records results.

---

## Pre-Drill Checklist (T-48 hours)

- [ ] Notify stakeholders via `#ops-alerts` Slack channel — include date/time and expected impact window
- [ ] Confirm the secondary region warm standby is provisioned (`terraform output dr_secondary_rds_identifier` returns a non-empty value)
- [ ] Verify RDS replica lag is < 60 s (CloudWatch alarm `agri-fi-<env>-secondary-replica-lag` is in OK state)
- [ ] Confirm `SECONDARY_HEALTH_URL`, `ROUTE53_HEALTH_CHECK_ID`, and all env vars in the script header are set in the `.env.dr` file
- [ ] Ensure `disaster-recovery.sh` is the latest version from `main` branch
- [ ] Open the AWS Console in both `PRIMARY_REGION` and `SECONDARY_REGION` in separate tabs
- [ ] Ensure the witness engineer has read access to CloudWatch, RDS, ECS, and Route53

---

## Drill Execution Procedure

### Step 0 — Dry run (always first)

```bash
# Load DR environment variables
source devops/scripts/.env.dr

# Run in dry-run mode — prints commands, makes no changes
./devops/scripts/disaster-recovery.sh drill
```

Review the output. Every step should print `[DRY RUN]` and exit 0. Fix any
missing env vars or tool dependencies before proceeding.

### Step 1 — Execute failover

```bash
./devops/scripts/disaster-recovery.sh failover
```

Expected console output (< 15 min):

```
[T+00:00] STARTING MULTI-REGION FAILOVER
[T+00:05] Step 2/6: Promoting secondary RDS read replica…
[T+03:00] Secondary RDS instance is available
[T+03:10] Step 3/6: Scaling up secondary ECS service…
[T+05:30] ECS service is stable
[T+05:35] Step 4/6: Updating Route53 DNS failover…
[T+05:40] Step 5/6: Updating Kubernetes ConfigMap…
[T+05:45] Step 6/6: Verifying secondary service health…
[T+06:00] Secondary service is healthy
[T+06:00] Failover completed in 6m 0s (RTO target: < 15 min) ✓
```

### Step 2 — RTO/RPO measurement

| Metric | How to measure | Target |
|--------|---------------|--------|
| RTO    | Elapsed time printed by `record_failover_time` | < 15 minutes |
| RPO    | Max RDS replica lag in CloudWatch during the drill window | < 1 minute |
| DNS TTL propagation | `dig +short <FAILOVER_RECORD_NAME>` from external resolver | < 60 seconds after health check flip |

Record measurements in the [DR Results Log](#dr-results-log) below.

### Step 3 — Smoke test the secondary

```bash
# Confirm the API is responding on the secondary
curl -s https://<FAILOVER_RECORD_NAME>/health | jq .

# Run a basic end-to-end check
curl -s -X POST https://<FAILOVER_RECORD_NAME>/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"drill@agri-fi.test","password":"drillpass"}' | jq .status
```

Expected: `{"status":"ok"}` from `/health` and HTTP 200 from login.

---

## Failback Procedure

Run failback **only after** verifying the primary region is healthy again and
the on-call engineer has confirmed with a second approver.

### Step 1 — Confirm primary recovery

```bash
./devops/scripts/disaster-recovery.sh status
```

Primary RDS and ECS should show `available` / `ACTIVE` in the output.

### Step 2 — Execute failback

```bash
./devops/scripts/disaster-recovery.sh failback
```

This will:
1. Scale secondary ECS service back to 0 (warm standby)
2. Re-enable the primary Route53 health check so traffic returns to primary
3. Print instructions for rebuilding the RDS read replica

### Step 3 — Rebuild the RDS read replica (manual)

After promotion, the secondary RDS instance is a standalone database.
Re-establish the replica so the next DR event has a fresh standby:

```bash
cd devops/terraform

# This will destroy the promoted standalone and create a fresh replica
terraform apply \
  -var="dr_enabled=true" \
  -var="dr_secondary_region=us-west-2" \
  -var="dr_db_password=${DR_DB_PASSWORD}"
```

Wait for the replica to finish initial sync (visible in CloudWatch `ReplicaLag`
dropping to near-zero) before marking the failback complete.

### Step 4 — Verify primary is serving traffic

```bash
dig +short <FAILOVER_RECORD_NAME>   # should resolve to primary ALB IP

curl -s https://<FAILOVER_RECORD_NAME>/health | jq .
```

### Step 5 — Post-drill notification

Post to `#ops-alerts`:
```
✅ DR drill / failback complete.
RTO: <N> min | RPO: <M> s
Next drill: <date>
```

---

## RTO/RPO Test Procedure (detailed)

### RTO Measurement

1. Note `START_TIME` from the first log line of `cmd_failover`
2. Note `END_TIME` from the `record_failover_time` log line
3. RTO = END_TIME − START_TIME

If RTO > 15 min, investigate which step exceeded budget:

| Step | Expected duration | Investigation if slow |
|------|-----------------|----------------------|
| RDS promotion | 2–5 min | Check instance class; t3.micro is slower than t3.medium |
| ECS service stable | 1–3 min | Check task definition; image pull latency; health check misconfiguration |
| Route53 propagation | < 1 min | Verify health check failure_threshold = 5 and TTL |
| Secondary health verify | < 2 min | Check SECONDARY_HEALTH_URL; confirm ALB target group health check path |

### RPO Measurement

1. In CloudWatch, open the `ReplicaLag` metric for `SECONDARY_RDS_IDENTIFIER`
2. Find the maximum lag value in the 30-minute window before `promote_rds_replica` was called
3. RPO = max `ReplicaLag` value in seconds

If RPO > 60 s, the `rds_replica_lag` CloudWatch alarm should have already fired.
Root causes to investigate:
- Network throughput between regions (check VPC peering or Transit Gateway)
- Writes-per-second on primary exceeding replica capacity
- Replica instance class too small

---

## DR Results Log

Copy and complete this template after each drill:

```
## Drill / Incident: <YYYY-MM-DD>

| Field              | Value |
|--------------------|-------|
| Type               | Drill / Incident |
| Lead engineer      |       |
| Witness            |       |
| Failover start     |       |
| Failover end       |       |
| RTO achieved       |       |
| RPO achieved       |       |
| RTO target met     | Yes / No |
| RPO target met     | Yes / No |
| Issues encountered |       |
| Action items       |       |
| Failback start     |       |
| Failback end       |       |
| RDS replica rebuilt| Yes / No |
| Notes              |       |
```

---

## Key Contacts

| Role | Contact |
|------|---------|
| On-call lead | Rotate per PagerDuty schedule |
| AWS account owner | Platform team Slack: `#platform-eng` |
| Database DBA | Database team Slack: `#db-ops` |
| Incident commander | See incident response playbook |

---

## Reference

- Terraform module: `devops/terraform/modules/secondary-region/`
- DR Terraform integration: `devops/terraform/dr.tf`
- Failover script: `devops/scripts/disaster-recovery.sh`
- CloudWatch alarms: `agri-fi-<env>-secondary-replica-lag`, `agri-fi-<env>-primary-health-check-failed`
- Route53 health check: managed by `aws_route53_health_check.primary` in the module
- Stellar note: All Stellar/blockchain operations continue to target testnet during DR events; no Stellar-specific failover is required
