# DR (Disaster Recovery) integration for Agri-Fi (#903)
# Instantiates the secondary-region warm standby module when dr_enabled = true.
#
# Usage:
#   terraform apply -var="dr_enabled=true" -var="dr_secondary_region=us-west-2"
#
# The secondary provider alias lets Terraform manage resources in both regions
# from the same root module without duplicating provider configuration.

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "dr_enabled" {
  description = "Set to true to provision the warm standby DR stack in the secondary region. Defaults to false to avoid accidental cost in non-production environments."
  type        = bool
  default     = false
}

variable "dr_secondary_region" {
  description = "AWS region for the warm standby DR deployment."
  type        = string
  default     = "us-west-2"
}

variable "dr_backend_image" {
  description = "Docker image URI for the secondary region backend container."
  type        = string
  default     = ""
}

variable "dr_frontend_image" {
  description = "Docker image URI for the secondary region frontend container."
  type        = string
  default     = ""
}

variable "dr_db_password" {
  description = "Master password for the secondary RDS instance. Supply via TF_VAR_dr_db_password."
  type        = string
  sensitive   = true
  default     = ""
}

variable "dr_sns_alert_arn" {
  description = "ARN of the SNS topic for DR CloudWatch alarm notifications."
  type        = string
  default     = ""
}

variable "dr_route53_zone_id" {
  description = "Route53 hosted zone ID used for failover DNS records."
  type        = string
  default     = ""
}

variable "dr_primary_endpoint" {
  description = "FQDN of the primary ALB used as the Route53 health check target and PRIMARY alias."
  type        = string
  default     = ""
}

variable "dr_failover_record_name" {
  description = "DNS name for the failover A record (e.g. api.agri-fi.example.com)."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Secondary region provider
# ---------------------------------------------------------------------------

provider "aws" {
  alias  = "secondary"
  region = var.dr_secondary_region
}

# ---------------------------------------------------------------------------
# DR module instantiation (only when dr_enabled = true)
# ---------------------------------------------------------------------------

module "disaster_recovery" {
  count  = var.dr_enabled ? 1 : 0
  source = "./modules/secondary-region"

  providers = {
    aws = aws.secondary
  }

  # Region configuration
  primary_region   = "us-east-1"
  secondary_region = var.dr_secondary_region

  # Identity
  project     = var.project_name
  environment = var.environment

  # RDS
  primary_rds_identifier  = aws_db_instance.postgres.identifier
  primary_db_snapshot_arn = aws_db_instance.postgres.latest_restorable_time != null ? "arn:aws:rds:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:snapshot:${aws_db_instance.postgres.identifier}-auto-snapshot" : ""
  db_instance_class       = "db.t3.medium"
  db_password             = var.dr_db_password

  # Container images
  backend_image  = var.dr_backend_image
  frontend_image = var.dr_frontend_image

  # Networking
  vpc_cidr  = "10.1.0.0/16"
  az_count  = 2

  # Observability / alerting
  sns_alert_arn = var.dr_sns_alert_arn

  # Route53 failover
  route53_zone_id      = var.dr_route53_zone_id
  primary_endpoint     = var.dr_primary_endpoint
  failover_record_name = var.dr_failover_record_name
}

# Data source required to construct the snapshot ARN
data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Outputs (only populated when dr_enabled = true)
# ---------------------------------------------------------------------------

output "dr_secondary_rds_identifier" {
  description = "Identifier of the secondary RDS read replica. Empty when dr_enabled = false."
  value       = var.dr_enabled ? module.disaster_recovery[0].secondary_rds_identifier : ""
}

output "dr_secondary_ecs_cluster_arn" {
  description = "ARN of the secondary ECS cluster. Empty when dr_enabled = false."
  value       = var.dr_enabled ? module.disaster_recovery[0].secondary_ecs_cluster_arn : ""
}

output "dr_secondary_redis_endpoint" {
  description = "Primary endpoint of the secondary ElastiCache Redis. Empty when dr_enabled = false."
  value       = var.dr_enabled ? module.disaster_recovery[0].secondary_redis_endpoint : ""
}

output "dr_route53_health_check_id" {
  description = "Route53 health check ID for the primary endpoint. Empty when dr_enabled = false."
  value       = var.dr_enabled ? module.disaster_recovery[0].route53_health_check_id : ""
}

output "dr_secondary_alb_dns_name" {
  description = "DNS name of the secondary region ALB. Empty when dr_enabled = false."
  value       = var.dr_enabled ? module.disaster_recovery[0].secondary_alb_dns_name : ""
}
