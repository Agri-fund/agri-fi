# PostgreSQL database for the Agri-Fi backend, managed as code.
# Network access is restricted to the backend subnet; storage autoscaling and
# automated backups are enabled for production durability.

resource "aws_db_subnet_group" "postgres" {
  name       = "agrifi-postgres"
  subnet_ids = var.db_subnet_ids

  tags = {
    Name    = "agrifi-postgres"
    Project = "agri-fi"
  }
}

resource "aws_security_group" "postgres" {
  name        = "agrifi-postgres-sg"
  description = "Allow PostgreSQL access from the backend subnet only"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from backend subnet"
    from_port   = 5432
    to_port     = 5432
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
    Name    = "agrifi-postgres-sg"
    Project = "agri-fi"
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "agrifi-postgres"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password
  port     = 5432

  storage_type          = "gp3"
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds_credentials.arn

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  backup_retention_period = var.db_backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "agrifi-postgres-final"

  tags = {
    Name    = "agrifi-postgres"
    Project = "agri-fi"
  }
}

resource "aws_db_instance" "postgres_replica" {
  identifier             = "agrifi-postgres-replica"
  replicate_source_db    = aws_db_instance.postgres.identifier
  instance_class         = var.db_instance_class
  skip_final_snapshot    = true
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.postgres.id]

  tags = {
    Name    = "agrifi-postgres-replica"
    Project = "agri-fi"
  }
}

# Secrets Manager secret for automatic credential rotation (#852)
resource "aws_secretsmanager_secret" "rds_credentials" {
  name       = "${var.project}/${var.environment}/rds-credentials"
  kms_key_id = aws_kms_key.rds_credentials.arn

  recovery_window_in_days = 7

  tags = {
    Name        = "${var.project}-${var.environment}-rds-secret"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_rotation" "rds_credentials" {
  secret_id           = aws_secretsmanager_secret.rds_credentials.id
  rotation_lambda_arn = var.rds_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 30
  }
}

resource "aws_cloudwatch_metric_alarm" "rotation_failed" {
  alarm_name          = "${var.project}-${var.environment}-secret-rotation-failed"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ResourceCount"
  namespace           = "AWS/SecretsManager"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1
  alarm_description   = "Alert when RDS credential rotation fails"

  dimensions = {
    SecretId = aws_secretsmanager_secret.rds_credentials.id
  }

  alarm_actions = [var.sns_alert_arn]
}

output "rds_postgres_endpoint" {
  description = "Connection endpoint for the PostgreSQL primary instance."
  value       = aws_db_instance.postgres.endpoint
}

output "rds_postgres_replica_endpoint" {
  description = "Connection endpoint for the PostgreSQL read replica."
  value       = aws_db_instance.postgres_replica.endpoint
}

output "rds_secret_arn" {
  value       = aws_secretsmanager_secret.rds_credentials.arn
  description = "ARN of the Secrets Manager secret holding RDS credentials"
}
