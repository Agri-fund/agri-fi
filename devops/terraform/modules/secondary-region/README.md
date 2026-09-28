# Secondary Region Module

This module provisions a warm EKS control plane with a zero-sized managed node
group, an encrypted cross-region RDS replica, an ElastiCache Global Datastore
replica, and a Route 53 health check with a five-minute CloudWatch alarm.

The caller must provide both region-specific AWS providers and existing
networking, KMS, Redis, DNS-health, and alerting inputs. The secondary VPC must
have at least two EKS control-plane subnets and private worker/database
subnets. Worker subnets need outbound access to pull the application images.
The EKS API endpoint is private-only, so the failover runner must be reachable
from the secondary VPC. Supply SNS topics in both regions: CloudWatch actions
must target a topic in the alarm's region.

Example provider wiring:

```hcl
provider "aws" {
  alias  = "primary"
  region = var.primary_region
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
}

module "secondary_region" {
  source = "../modules/secondary-region"

  providers = {
    aws.primary   = aws.primary
    aws.secondary = aws.secondary
  }

  # Supply the module variables from account-specific remote state/outputs.
}
```

The primary Redis replication group must already meet ElastiCache Global
Datastore requirements. In particular, its Redis engine version and node type
must support Global Datastore; the existing `cache.t3.micro` default is not a
valid production sizing assumption for this feature. The selected failover IAM
role receives cluster-admin access to the standby EKS API and should be tightly
restricted.

EKS control-plane charges and RDS/Redis replica charges continue while the
region is idle. Worker compute starts at zero and is raised by
`devops/scripts/disaster-recovery.sh` during failover. A CloudWatch alarm
notifies when RDS replication lag exceeds 60 seconds; this is a warning, not a
guarantee of sub-minute RPO.