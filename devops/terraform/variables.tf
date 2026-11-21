# Variables for the PostgreSQL RDS deployment (see rds.tf).

variable "db_name" {
  description = "Name of the initial PostgreSQL database."
  type        = string
  default     = "agrifi"
}

variable "db_username" {
  description = "Master username for the PostgreSQL instance."
  type        = string
  default     = "agrifi_admin"
}

variable "db_password" {
  description = "Master password. Supply via TF_VAR_db_password or a secrets backend; never commit a real value."
  type        = string
  sensitive   = true
}

variable "db_engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.4"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Upper bound for storage autoscaling in GiB. Set equal to db_allocated_storage to disable autoscaling."
  type        = number
  default     = 100
}

variable "db_backup_retention_period" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Deploy the instance across multiple availability zones."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "VPC the RDS instance and its security group live in."
  type        = string
}

variable "db_subnet_ids" {
  description = "Private subnet IDs used for the RDS subnet group."
  type        = list(string)
}

variable "backend_subnet_cidrs" {
  description = "CIDR blocks of the backend application subnet(s) allowed to reach PostgreSQL on 5432."
  type        = list(string)
}


variable "ecs_subnet_ids" {
  description = "Subnet IDs for ECS tasks"
  type        = list(string)
}

variable "alb_subnet_ids" {
  description = "Subnet IDs for the Application Load Balancer"
  type        = list(string)
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "stellar_platform_secret" {
  description = "Stellar platform secret key"
  type        = string
  sensitive   = true
}

# VPC Configuration Variables
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "agrifi"
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
  default     = "staging"
}

variable "availability_zones" {
  description = "List of availability zones for subnets"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "single_nat_gateway" {
  description = "Should be true if you want to provision a single shared NAT Gateway across all of your private networks"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Redis ElastiCache variables
# ---------------------------------------------------------------------------

variable "redis_node_type" {
  description = "ElastiCache node type for Redis."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "redis_num_replicas" {
  description = "Number of read replicas (total nodes = redis_num_replicas + 1 primary)."
  type        = number
  default     = 1
}

# ---------------------------------------------------------------------------
# Trace storage (Elasticsearch for Jaeger, #1308)
# ---------------------------------------------------------------------------

variable "trace_es_engine_version" {
  description = "Elasticsearch engine version for the Jaeger trace store (Jaeger 1.60 supports ES 7.x/8.x; AWS-managed Elasticsearch tops out at 7.10)."
  type        = string
  default     = "Elasticsearch_7.10"
}

variable "trace_es_instance_type" {
  description = "Data node instance type. Staging: t3.small.search; production: r6g.large.search or larger."
  type        = string
  default     = "t3.small.search"
}

variable "trace_es_instance_count" {
  description = "Number of data nodes. Use 2+ (with zone awareness) in production."
  type        = number
  default     = 1
}

variable "trace_es_zone_awareness_enabled" {
  description = "Spread data nodes across two AZs. Requires trace_es_instance_count to be an even number >= 2."
  type        = bool
  default     = false
}

variable "trace_es_volume_size_gb" {
  description = "EBS volume size per data node, in GiB. Size for ~30 days of traces."
  type        = number
  default     = 50
}

variable "trace_es_master_user" {
  description = "Master username for fine-grained access control (used by Jaeger)."
  type        = string
  default     = "jaeger"
}

variable "trace_retention_days" {
  description = "Trace retention enforced by the ILM policy applied by the Helm chart / docker-compose."
  type        = number
  default     = 30
}
