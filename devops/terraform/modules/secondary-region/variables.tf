# Variables for the secondary-region warm standby module (#903).
# All variables are declared here with descriptions; inline defaults in main.tf
# act as documentation of canonical values.

variable "primary_region" {
  description = "AWS region where the primary Agri-Fi stack runs."
  type        = string
  default     = "us-east-1"
}

variable "secondary_region" {
  description = "AWS region where the warm standby is provisioned."
  type        = string
  default     = "us-west-2"
}

variable "project" {
  description = "Project identifier used in resource names and tags (e.g. agri-fi)."
  type        = string
  default     = "agri-fi"
}

variable "environment" {
  description = "Deployment environment (e.g. staging, production). Used in resource names."
  type        = string
}

variable "primary_rds_identifier" {
  description = "DB instance identifier of the primary RDS PostgreSQL instance to replicate from."
  type        = string
}

variable "primary_db_snapshot_arn" {
  description = "ARN of the most recent automated snapshot of the primary RDS instance. Used as a reference for initial DR readiness checks; not used directly by replicate_source_db."
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class for the secondary read replica. Use db.t3.medium or larger for production DR."
  type        = string
  default     = "db.t3.medium"
}

variable "db_password" {
  description = "Master password for the secondary RDS instance. Supply via TF_VAR_db_password or a secrets backend; never commit plaintext."
  type        = string
  sensitive   = true
}

variable "vpc_cidr" {
  description = "CIDR block for the secondary region VPC. Must not overlap with the primary VPC (default 10.0.0.0/16)."
  type        = string
  default     = "10.1.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones (and subnets) to create in the secondary region. Minimum 2 for RDS subnet groups."
  type        = number
  default     = 2
}

variable "backend_image" {
  description = "Docker image URI for the backend container (e.g. 123456789.dkr.ecr.us-west-2.amazonaws.com/agri-fi-backend:latest)."
  type        = string
}

variable "frontend_image" {
  description = "Docker image URI for the frontend container. Reserved for future secondary frontend deployment."
  type        = string
}

variable "container_port" {
  description = "TCP port the backend container listens on."
  type        = number
  default     = 3001
}

variable "health_check_path" {
  description = "HTTP path used by the ALB target group health check and Route53 HTTPS health check."
  type        = string
  default     = "/health"
}

variable "sns_alert_arn" {
  description = "ARN of the SNS topic that receives CloudWatch alarm notifications (ops paging)."
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID in which the failover DNS records will be created."
  type        = string
}

variable "primary_endpoint" {
  description = "Fully qualified domain name of the primary region ALB (e.g. agri-fi-alb-xxxx.us-east-1.elb.amazonaws.com). Used as the Route53 PRIMARY alias target and the Route53 HTTPS health check FQDN."
  type        = string
}

variable "failover_record_name" {
  description = "DNS name for the failover A record pair (e.g. api.agri-fi.example.com). Both PRIMARY and SECONDARY records share this name."
  type        = string
}
