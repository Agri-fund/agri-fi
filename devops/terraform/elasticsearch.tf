# Elasticsearch domain for durable Jaeger trace storage (#1308).
#
# Replaces Jaeger's in-memory span store (lost on every restart). The domain is
# VPC-only, encrypted at rest and in transit, and protected by fine-grained
# access control. Credentials are generated here and stored in Secrets Manager.
#
# Staging and production use the same resource; size them through
# `trace_es_*` variables in the per-environment tfvars, e.g.
#
#   staging:     trace_es_instance_type = "t3.small.search"   trace_es_instance_count = 1
#   production:  trace_es_instance_type = "r6g.large.search"  trace_es_instance_count = 2
#                trace_es_zone_awareness_enabled = true       trace_es_volume_size_gb = 200
#
# The 30-day rollover/delete ILM policy is installed by the Helm chart
# (tracing.elasticsearch.*) or docker-compose — see devops/observability/.

resource "random_password" "trace_es_master_password" {
  length           = 32
  special          = true
  min_upper        = 1
  min_lower        = 1
  min_numeric      = 1
  min_special      = 1
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_security_group" "trace_es" {
  name        = "${var.project_name}-${var.environment}-trace-es-sg"
  description = "Allow HTTPS to the trace Elasticsearch domain from backend subnets only"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from backend / cluster subnets"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.backend_subnet_cidrs
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-trace-es-sg"
    Project     = "agri-fi"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_caller_identity" "trace_es" {}

resource "aws_opensearch_domain" "traces" {
  domain_name    = "${var.project_name}-${var.environment}-traces"
  engine_version = var.trace_es_engine_version

  cluster_config {
    instance_type          = var.trace_es_instance_type
    instance_count         = var.trace_es_instance_count
    zone_awareness_enabled = var.trace_es_zone_awareness_enabled

    dynamic "zone_awareness_config" {
      for_each = var.trace_es_zone_awareness_enabled ? [1] : []
      content {
        availability_zone_count = 2
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.trace_es_volume_size_gb
  }

  vpc_options {
    subnet_ids         = slice(var.db_subnet_ids, 0, var.trace_es_zone_awareness_enabled ? 2 : 1)
    security_group_ids = [aws_security_group.trace_es.id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true

    master_user_options {
      master_user_name     = var.trace_es_master_user
      master_user_password = random_password.trace_es_master_password.result
    }
  }

  # Network access is restricted by the VPC + security group; per-user
  # authorisation is enforced by fine-grained access control above.
  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "es:*"
      Resource  = "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.trace_es.account_id}:domain/${var.project_name}-${var.environment}-traces/*"
    }]
  })

  tags = {
    Name        = "${var.project_name}-${var.environment}-traces"
    Project     = "agri-fi"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret" "trace_es_credentials" {
  name                    = "${var.project_name}/${var.environment}/trace-es-credentials"
  recovery_window_in_days = 7

  tags = {
    Name        = "${var.project_name}-${var.environment}-trace-es-secret"
    Project     = "agri-fi"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "trace_es_credentials" {
  secret_id = aws_secretsmanager_secret.trace_es_credentials.id

  # Keys match the Helm chart's secrets.jaegerEs*Key defaults so the secret can
  # be synced straight into the `agri-fi-backend-secrets` Kubernetes Secret.
  secret_string = jsonencode({
    JAEGER_ES_SERVER_URLS = "https://${aws_opensearch_domain.traces.endpoint}"
    JAEGER_ES_USERNAME    = var.trace_es_master_user
    JAEGER_ES_PASSWORD    = random_password.trace_es_master_password.result
  })
}
