# Multi-Region Disaster Recovery

## Provisioning

Use `devops/terraform/modules/secondary-region` with `aws.primary` and
`aws.secondary` provider aliases. Supply an existing secondary VPC, private
subnets with outbound image access, a secondary-region KMS key, an encrypted
primary RDS ARN, the primary Redis replication-group ID, and SNS topics in
both regions.
The module creates the standby EKS control plane and zero-sized node group,
cross-region PostgreSQL and Redis replicas, and a Route 53 health check plus a
CloudWatch alarm configured for five consecutive unhealthy minutes. A second
alarm notifies when standby RDS replication lag exceeds 60 seconds.

Before applying, confirm the primary Redis engine and node type support Global
Datastore. The repository's current `cache.t3.micro` primary default is not a
valid Global Datastore sizing assumption. Provision the standby Argo CD/GitOps
configuration and sync application manifests before enabling the watcher; the
managed node group starts at zero, but Kubernetes resources must already exist
in the control plane.

The failover runner must be hosted outside the primary failure domain, have
AWS CLI, `kubectl`, `jq`, and `curl`, and assume the IAM role supplied as
`failover_role_arn`. Restrict that role to the named RDS replica, Redis group,
EKS cluster/node group, Route 53 record, and SNS topic. Its Kubernetes access is
cluster-admin because it patches the backend ConfigMap. Run it in the
secondary VPC because the standby EKS API endpoint is private-only, and provide
an instance profile or equivalent role credentials.

The public Route 53 zone must contain `API_RECORD_NAME` as a CNAME with a
60-second TTL, initially targeting the primary ingress. The script upserts
that same CNAME to `SECONDARY_API_TARGET` only after data promotion and the
backend rollout succeed.

Configure `/etc/agri-fi/disaster-recovery.env` with mode `0600`:

```sh
SECONDARY_REGION=us-west-2
EKS_CLUSTER_NAME=agrifi-standby
EKS_NODEGROUP_NAME=agrifi-standby-workers
RDS_REPLICA_ID=agrifi-standby-postgres
REDIS_GLOBAL_REPLICATION_GROUP_ID=agrifi-global
REDIS_REPLICA_GROUP_ID=agrifi-standby-redis
ROUTE53_ZONE_ID=Z1234567890
API_RECORD_NAME=api.agri-fi.com
SECONDARY_API_TARGET=standby-ingress.example.net
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:ops-alerts
PRIMARY_API_HEALTH_URL=https://api.agri-fi.com/v1/health
K8S_NAMESPACE=agri-fi
BACKEND_CONFIGMAP=agri-fi-backend-config
```

Install `devops/scripts/disaster-recovery.sh` at `/opt/agri-fi/` and
`devops/scripts/disaster-recovery.service` at
`/etc/systemd/system/agri-fi-disaster-recovery.service`. Create the
`agri-fi-dr` system account, make `/opt/agri-fi/disaster-recovery.sh`
executable, and then enable the watcher:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now agri-fi-disaster-recovery
sudo systemctl status agri-fi-disaster-recovery
```

The watcher waits 60 seconds between checks and runs failover after five
consecutive failed requests (at least five minutes from the first probe). It
promotes RDS and the secondary Redis group, scales EKS workers, updates the
backend ConfigMap, waits for the backend rollout, switches the API CNAME, and
publishes an SNS notification. Health alarm notifications and watcher logs
should both page the on-call team.

For an operator-triggered failover, stop the watcher to prevent duplicate
execution and run:

```sh
sudo systemctl stop agri-fi-disaster-recovery
sudo -u agri-fi-dr /opt/agri-fi/disaster-recovery.sh failover
```

## Failback

Failback is a controlled maintenance operation, never automatic. Keep the
secondary as the only writer. Restore the original region and network, create
a new cross-region replica from the current secondary primary, wait until its
replication lag is zero, and verify application writes in the restored region.
Schedule a maintenance window, stop the watcher, promote the rebuilt replica,
scale the original cluster, update its database and Redis endpoints, verify
workload health, and then change the API CNAME back. Re-establish Redis Global
Datastore membership and RDS replication in the reverse direction before
re-enabling the watcher. Do not promote the old primary or route writes to it
until it has been rebuilt from the current writer; that prevents split brain.

## RTO, RPO, and Quarterly Drill

The 15-minute RTO and sub-minute RPO are targets, not verified guarantees.
Cross-region RDS replication is asynchronous, so actual RPO depends on observed
replica lag at incident time. Do not advertise either target as met until a
staging drill records timestamps for health detection, database/Redis
promotion, worker readiness, application recovery, and DNS propagation, and
compares the last acknowledged write with the recovered database.

Run a staging disaster-recovery drill quarterly. The scheduled workflow opens
a reminder issue on January 1, April 1, July 1, and October 1. Record measured
RTO, measured RPO, replica lag, DNS convergence, operator actions, and follow-up
items in that issue. Perform a write-load test during the drill to verify the
sub-minute RPO; do not run it against production.