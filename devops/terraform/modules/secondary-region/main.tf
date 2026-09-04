# Secondary region warm standby module for multi-region DR (#903)
# Provisions: VPC, ECS cluster (scaled down), RDS read replica promotion target,
# ElastiCache for Redis, Route53 health check integration

# ---------------------------------------------------------------------------
# Variable declarations (also reflected in variables.tf with descriptions)
# ---------------------------------------------------------------------------

variable "primary_region" { default = "us-east-1" }
variable "secondary_region" { default = "us-west-2" }
variable "project" { default = "agri-fi" }
variable "environment" {}
variable "primary_rds_identifier" {}
variable "primary_db_snapshot_arn" {}
variable "db_instance_class" { default = "db.t3.medium" }
variable "db_password" { sensitive = true }
variable "vpc_cidr" { default = "10.1.0.0/16" }
variable "az_count" { default = 2 }
variable "backend_image" {}
variable "frontend_image" {}
variable "container_port" { default = 3001 }
variable "health_check_path" { default = "/health" }
variable "sns_alert_arn" {}
variable "route53_zone_id" {}
variable "primary_endpoint" {}
variable "failover_record_name" {}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

resource "aws_vpc" "secondary" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.project}-secondary-vpc"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    DR          = "secondary"
  }
}

resource "aws_internet_gateway" "secondary" {
  vpc_id = aws_vpc.secondary.id

  tags = {
    Name        = "${var.project}-secondary-igw"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Derive subnet CIDRs from the VPC CIDR by splitting /16 into /24 blocks.
# Subnet 0 and 1 are public; subnets 10 and 11 are private.
locals {
  vpc_prefix = regex("^(\\d+\\.\\d+)", var.vpc_cidr)[0]

  public_subnets = [
    "${local.vpc_prefix}.1.0/24",
    "${local.vpc_prefix}.2.0/24",
  ]
  private_subnets = [
    "${local.vpc_prefix}.10.0/24",
    "${local.vpc_prefix}.11.0/24",
  ]
}

# Two public subnets spread across AZs
resource "aws_subnet" "secondary" {
  count = var.az_count

  vpc_id                  = aws_vpc.secondary.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = "${var.secondary_region}${count.index == 0 ? "a" : "b"}"
  map_public_ip_on_launch = true

  tags = {
    Name        = "${var.project}-secondary-public-subnet-${count.index + 1}"
    Project     = var.project
    Environment = var.environment
    Type        = "Public"
    ManagedBy   = "terraform"
  }
}

# Two private subnets (used for RDS, ElastiCache, and ECS tasks)
resource "aws_subnet" "secondary_private" {
  count = var.az_count

  vpc_id            = aws_vpc.secondary.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = "${var.secondary_region}${count.index == 0 ? "a" : "b"}"

  tags = {
    Name        = "${var.project}-secondary-private-subnet-${count.index + 1}"
    Project     = var.project
    Environment = var.environment
    Type        = "Private"
    ManagedBy   = "terraform"
  }
}

# Public route table — routes all traffic through the IGW
resource "aws_route_table" "secondary_public" {
  vpc_id = aws_vpc.secondary.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.secondary.id
  }

  tags = {
    Name        = "${var.project}-secondary-public-rt"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_route_table_association" "secondary_public" {
  count          = var.az_count
  subnet_id      = aws_subnet.secondary[count.index].id
  route_table_id = aws_route_table.secondary_public.id
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "secondary_alb" {
  name        = "${var.project}-secondary-alb-sg"
  description = "ALB security group for secondary region"
  vpc_id      = aws_vpc.secondary.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-secondary-alb-sg"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_security_group" "secondary_ecs" {
  name        = "${var.project}-secondary-ecs-sg"
  description = "ECS task security group for secondary region"
  vpc_id      = aws_vpc.secondary.id

  ingress {
    description     = "Allow inbound from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.secondary_alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-secondary-ecs-sg"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_security_group" "secondary_rds" {
  name        = "${var.project}-secondary-rds-sg"
  description = "RDS security group for secondary region"
  vpc_id      = aws_vpc.secondary.id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.secondary_ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-secondary-rds-sg"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_security_group" "secondary_redis" {
  name        = "${var.project}-secondary-redis-sg"
  description = "ElastiCache security group for secondary region"
  vpc_id      = aws_vpc.secondary.id

  ingress {
    description     = "Redis from ECS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.secondary_ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-secondary-redis-sg"
    Project     = var.project
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# RDS — read replica (warm standby; promoted to primary on failover)
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "secondary" {
  name       = "${var.project}-secondary-db-subnet-group"
  subnet_ids = aws_subnet.secondary_private[*].id

  tags = {
    Name        = "${var.project}-secondary-db-subnet-group"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_db_instance" "secondary_replica" {
  identifier = "${var.project}-${var.environment}-secondary-replica"

  # Read replica replicates from the primary instance by ARN/snapshot.
  # On failover, promote-read-replica is called to convert this to standalone.
  replicate_source_db = var.primary_rds_identifier

  instance_class = var.db_instance_class
  password       = var.db_password

  # Warm standby does not need Multi-AZ — saves cost; can be toggled on failover
  multi_az            = false
  publicly_accessible = false

  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.secondary.name
  vpc_security_group_ids = [aws_security_group.secondary_rds.id]

  # Skip final snapshot — this replica can be recreated from the primary
  skip_final_snapshot = true

  # Replica lag alarm threshold (60s) is configured in CloudWatch below
  tags = {
    Name        = "${var.project}-${var.environment}-secondary-replica"
    Project     = var.project
    Environment = var.environment
    Failover    = "standby"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# ElastiCache — Redis replication group (warm standby)
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "secondary" {
  name       = "${var.project}-secondary-redis-subnet-group"
  subnet_ids = aws_subnet.secondary_private[*].id

  tags = {
    Name        = "${var.project}-secondary-redis-subnet-group"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_elasticache_replication_group" "secondary" {
  replication_group_id = "${var.project}-secondary-redis"
  description          = "Agri-Fi secondary region Redis warm standby"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t3.micro"
  num_cache_clusters   = 1
  parameter_group_name = "default.redis7"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.secondary.name
  security_group_ids = [aws_security_group.secondary_redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # Minimal maintenance window for standby
  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "04:00-05:00"

  tags = {
    Name        = "${var.project}-secondary-redis"
    Project     = var.project
    Environment = var.environment
    Failover    = "standby"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# ECS — cluster + task definition + service (desired_count=0 warm standby)
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "secondary" {
  name = "${var.project}-secondary"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "${var.project}-secondary"
    Project     = var.project
    Environment = var.environment
    DR          = "secondary"
    ManagedBy   = "terraform"
  }
}

resource "aws_cloudwatch_log_group" "secondary_ecs" {
  name              = "/ecs/${var.project}-secondary"
  retention_in_days = 30

  tags = {
    Name        = "${var.project}-secondary-ecs-logs"
    Project     = var.project
    Environment = var.environment
  }
}

# Minimal IAM execution role for the secondary cluster tasks
resource "aws_iam_role" "secondary_ecs_execution" {
  name = "${var.project}-secondary-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = {
    Name    = "${var.project}-secondary-ecs-execution-role"
    Project = var.project
  }
}

resource "aws_iam_role_policy_attachment" "secondary_ecs_execution" {
  role       = aws_iam_role.secondary_ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secondary_ecs_logs" {
  name = "${var.project}-secondary-ecs-logs-policy"
  role = aws_iam_role.secondary_ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.secondary_ecs.arn}:*"
    }]
  })
}

# Scaled-down backend task definition (256 CPU / 512 MB — warm standby footprint)
resource "aws_ecs_task_definition" "backend_secondary" {
  family                   = "${var.project}-backend-secondary"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.secondary_ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.backend_image
      essential = true
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "DATABASE_HOST", value = aws_db_instance.secondary_replica.address },
        { name = "DATABASE_PORT", value = "5432" },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.secondary.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "DR_REGION", value = var.secondary_region },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.secondary_ecs.name
          "awslogs-region"        = var.secondary_region
          "awslogs-stream-prefix" = "backend-secondary"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}${var.health_check_path} || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name        = "${var.project}-backend-secondary-task"
    Project     = var.project
    Environment = var.environment
    DR          = "secondary"
  }
}

# ALB for secondary region (needed for Route53 failover target)
resource "aws_lb" "secondary" {
  name               = "${var.project}-secondary-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.secondary_alb.id]
  subnets            = aws_subnet.secondary[*].id

  tags = {
    Name        = "${var.project}-secondary-alb"
    Project     = var.project
    Environment = var.environment
    DR          = "secondary"
    ManagedBy   = "terraform"
  }
}

resource "aws_lb_target_group" "secondary_backend" {
  name        = "${var.project}-sec-backend-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.secondary.id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = var.health_check_path
    matcher             = "200"
  }

  tags = {
    Name        = "${var.project}-secondary-backend-tg"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_lb_listener" "secondary_backend" {
  load_balancer_arn = aws_lb.secondary.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.secondary_backend.id
  }
}

# ECS service — desired_count=0 keeps infrastructure warm but costs near zero.
# The DR script scales this to 2 on failover.
resource "aws_ecs_service" "backend_secondary" {
  name            = "${var.project}-backend-secondary"
  cluster         = aws_ecs_cluster.secondary.id
  task_definition = aws_ecs_task_definition.backend_secondary.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.secondary_private[*].id
    security_groups  = [aws_security_group.secondary_ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.secondary_backend.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  # Allow external management of desired_count without Terraform drift
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.secondary_backend]

  tags = {
    Name        = "${var.project}-backend-secondary-service"
    Project     = var.project
    Environment = var.environment
    DR          = "secondary"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Route53 — health check + failover routing policy
# ---------------------------------------------------------------------------

# HTTP health check against the primary endpoint.
# 5 consecutive failures (5 minutes at 60 s interval) trigger failover.
resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_endpoint
  port              = 443
  type              = "HTTPS"
  resource_path     = var.health_check_path
  failure_threshold = 5
  request_interval  = 60

  tags = {
    Name        = "${var.project}-primary-health-check"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# PRIMARY failover record — serves traffic when primary is healthy
resource "aws_route53_record" "primary_failover" {
  zone_id = var.route53_zone_id
  name    = var.failover_record_name
  type    = "A"

  alias {
    # The primary ALB DNS is supplied as the primary_endpoint variable.
    # Route53 requires an alias zone_id; we use the well-known ALB zone for us-east-1.
    name                   = var.primary_endpoint
    zone_id                = "Z35SXDOTRQ7X7K" # us-east-1 ALB hosted zone ID
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "PRIMARY"
  }

  health_check_id = aws_route53_health_check.primary.id
  set_identifier  = "${var.project}-primary"
}

# SECONDARY failover record — activated automatically when primary fails health check
resource "aws_route53_record" "secondary_failover" {
  zone_id = var.route53_zone_id
  name    = var.failover_record_name
  type    = "A"

  alias {
    name                   = aws_lb.secondary.dns_name
    zone_id                = aws_lb.secondary.zone_id
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "SECONDARY"
  }

  set_identifier = "${var.project}-secondary"
}

# ---------------------------------------------------------------------------
# CloudWatch alarms
# ---------------------------------------------------------------------------

# Alert when RDS replica lag exceeds 60 seconds (RPO risk)
resource "aws_cloudwatch_metric_alarm" "rds_replica_lag" {
  alarm_name          = "${var.project}-${var.environment}-secondary-replica-lag"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 60
  alarm_description   = "Secondary RDS replica lag exceeded 60 seconds — RPO target at risk"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.secondary_replica.identifier
  }

  alarm_actions = [var.sns_alert_arn]
  ok_actions    = [var.sns_alert_arn]

  tags = {
    Name        = "${var.project}-secondary-replica-lag-alarm"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Alert when Route53 health check for the primary is failing
resource "aws_cloudwatch_metric_alarm" "primary_health_check_failed" {
  alarm_name          = "${var.project}-${var.environment}-primary-health-check-failed"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Primary region Route53 health check is failing — possible DR event"
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = aws_route53_health_check.primary.id
  }

  alarm_actions = [var.sns_alert_arn]
  ok_actions    = [var.sns_alert_arn]

  tags = {
    Name        = "${var.project}-primary-health-check-failed-alarm"
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
