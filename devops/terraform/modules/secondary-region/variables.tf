variable "name" {
  description = "Name prefix for secondary-region resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID in the secondary region."
  type        = string
}

variable "cluster_subnet_ids" {
  description = "At least two subnets for the standby EKS control plane."
  type        = list(string)
}

variable "node_subnet_ids" {
  description = "Private, internet-egress-enabled subnets for EKS workers."
  type        = list(string)
}

variable "database_subnet_ids" {
  description = "Private subnets for the cross-region RDS replica."
  type        = list(string)
}

variable "backend_subnet_cidrs" {
  description = "Private application subnet CIDRs allowed to reach standby PostgreSQL."
  type        = list(string)
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version supported in the selected region."
  type        = string
}

variable "node_instance_types" {
  description = "EC2 instance types used after the standby node group scales up."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "EKS node capacity type."
  type        = string
  default     = "ON_DEMAND"
}

variable "node_max_size" {
  description = "Maximum worker count during failover."
  type        = number
  default     = 6
}

variable "failover_role_arn" {
  description = "IAM role assumed by the failover runner to update Kubernetes resources."
  type        = string
}

variable "primary_rds_arn" {
  description = "ARN of the encrypted primary RDS PostgreSQL instance."
  type        = string
}

variable "database_kms_key_arn" {
  description = "KMS key ARN in the secondary region used to encrypt the read replica."
  type        = string
}

variable "database_instance_class" {
  description = "RDS class for the warm standby replica."
  type        = string
  default     = "db.t3.micro"
}

variable "primary_redis_replication_group_id" {
  description = "ID of the primary ElastiCache replication group."
  type        = string
}

variable "redis_global_id_suffix" {
  description = "Unique suffix for the Redis Global Datastore."
  type        = string
}

variable "redis_engine_version" {
  description = "Redis engine version compatible with the primary global group."
  type        = string
}

variable "redis_node_type" {
  description = "Redis node class supported by ElastiCache Global Datastore."
  type        = string
}

variable "redis_num_cache_clusters" {
  description = "Number of nodes in the standby Redis group; use at least two for automatic failover."
  type        = number
  default     = 2
}

variable "redis_subnet_group_name" {
  description = "Existing ElastiCache subnet group in the secondary region."
  type        = string
}

variable "redis_security_group_ids" {
  description = "Security groups attached to the secondary Redis replication group."
  type        = list(string)
}

variable "primary_api_hostname" {
  description = "Primary API hostname monitored by Route 53."
  type        = string
}

variable "primary_healthcheck_path" {
  description = "HTTPS path checked on the primary API."
  type        = string
  default     = "/v1/health"
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for the five-minute primary health alarm."
  type        = string
}

variable "secondary_sns_topic_arn" {
  description = "SNS topic ARN in the secondary region for the replica-lag alarm."
  type        = string
}