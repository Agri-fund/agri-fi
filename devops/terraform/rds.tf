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

  # gp3 storage with autoscaling between allocated and max_allocated.
  storage_type          = "gp3"
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  # Automated backups and maintenance windows.
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

  # Subnet group is inherited from the primary instance, do not specify db_subnet_group_name for replica.

  tags = {
    Name    = "agrifi-postgres-replica"
    Project = "agri-fi"
  }
}

output "rds_postgres_endpoint" {
  description = "Connection endpoint for the PostgreSQL primary instance."
  value       = aws_db_instance.postgres.endpoint
}

output "rds_postgres_replica_endpoint" {
  description = "Connection endpoint for the PostgreSQL read replica."
  value       = aws_db_instance.postgres_replica.endpoint
}
