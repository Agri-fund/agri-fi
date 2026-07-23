# ECS Cluster for Agri-Fi services
resource "aws_ecs_cluster" "agri_fi" {
  name = "agri-fi-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name    = "agri-fi-cluster"
    Project = "agri-fi"
  }
}

resource "aws_ecs_cluster_capacity_providers" "agri_fi" {
  cluster_name = aws_ecs_cluster.agri_fi.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# CloudWatch Log Group for ECS
resource "aws_cloudwatch_log_group" "ecs_logs" {
  name              = "/ecs/agri-fi"
  retention_in_days = 30

  tags = {
    Name    = "agri-fi-ecs-logs"
    Project = "agri-fi"
  }
}

# Backend Task Definition
resource "aws_ecs_task_definition" "backend" {
  family                   = "agri-fi-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "agri-fi/backend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = "3001"
        },
        {
          name  = "LOG_LEVEL"
          value = "info"
        },
        {
          name  = "DATABASE_HOST"
          value = aws_db_instance.postgres.address
        },
        {
          name  = "DATABASE_PORT"
          value = "5432"
        },
        {
          name  = "DATABASE_NAME"
          value = var.db_name
        },
        {
          name  = "STELLAR_NETWORK"
          value = "testnet"
        },
        {
          name  = "STELLAR_HORIZON_URL"
          value = "https://horizon-testnet.stellar.org"
        }
      ]
      secrets = [
        {
          name      = "DATABASE_USER"
          valueFrom = "${aws_secretsmanager_secret.db_user.arn}:username::"
        },
        {
          name      = "DATABASE_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.db_password.arn}:password::"
        },
        {
          name      = "JWT_SECRET"
          valueFrom = "${aws_secretsmanager_secret.jwt_secret.arn}:jwt_secret::"
        },
        {
          name      = "STELLAR_PLATFORM_SECRET"
          valueFrom = "${aws_secretsmanager_secret.stellar_secret.arn}:stellar_secret::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_logs.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "backend"
        }
      }
    }
  ])

  tags = {
    Name    = "agri-fi-backend-task"
    Project = "agri-fi"
  }
}

# Frontend Task Definition
resource "aws_ecs_task_definition" "frontend" {
  family                   = "agri-fi-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = "agri-fi/frontend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "NEXT_PUBLIC_API_URL"
          value = "https://api.agri-fi.example.com"
        },
        {
          name  = "BACKEND_URL"
          value = "https://api.agri-fi.example.com"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_logs.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "frontend"
        }
      }
    }
  ])

  tags = {
    Name    = "agri-fi-frontend-task"
    Project = "agri-fi"
  }
}

# Backend ECS Service
resource "aws_ecs_service" "backend" {
  name            = "agri-fi-backend-service"
  cluster         = aws_ecs_cluster.agri_fi.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [aws_security_group.ecs_backend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3001
  }

  depends_on = [
    aws_lb_listener.backend,
    aws_iam_role_policy.ecs_task_execution_policy
  ]

  tags = {
    Name    = "agri-fi-backend-service"
    Project = "agri-fi"
  }
}

# Frontend ECS Service
resource "aws_ecs_service" "frontend" {
  name            = "agri-fi-frontend-service"
  cluster         = aws_ecs_cluster.agri_fi.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [aws_security_group.ecs_frontend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 3001
  }

  depends_on = [
    aws_lb_listener.frontend,
    aws_iam_role_policy.ecs_task_execution_policy
  ]

  tags = {
    Name    = "agri-fi-frontend-service"
    Project = "agri-fi"
  }
}

# Application Load Balancer
resource "aws_lb" "agri_fi" {
  name               = "agri-fi-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.alb_subnet_ids

  tags = {
    Name    = "agri-fi-alb"
    Project = "agri-fi"
  }
}

# Backend Target Group
resource "aws_lb_target_group" "backend" {
  name        = "agri-fi-backend-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  tags = {
    Name    = "agri-fi-backend-tg"
    Project = "agri-fi"
  }
}

# Frontend Target Group
resource "aws_lb_target_group" "frontend" {
  name        = "agri-fi-frontend-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/"
    matcher             = "200"
  }

  tags = {
    Name    = "agri-fi-frontend-tg"
    Project = "agri-fi"
  }
}

# ALB Listener for Backend
resource "aws_lb_listener" "backend" {
  load_balancer_arn = aws_lb.agri_fi.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = aws_acm_certificate.agri_fi.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# ALB Listener for Frontend
resource "aws_lb_listener" "frontend" {
  load_balancer_arn = aws_lb.agri_fi.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# Security Groups
resource "aws_security_group" "alb" {
  name        = "agri-fi-alb-sg"
  description = "Security group for ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
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
    Name    = "agri-fi-alb-sg"
    Project = "agri-fi"
  }
}

resource "aws_security_group" "ecs_backend" {
  name        = "agri-fi-ecs-backend-sg"
  description = "Security group for ECS backend tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "agri-fi-ecs-backend-sg"
    Project = "agri-fi"
  }
}

resource "aws_security_group" "ecs_frontend" {
  name        = "agri-fi-ecs-frontend-sg"
  description = "Security group for ECS frontend tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "agri-fi-ecs-frontend-sg"
    Project = "agri-fi"
  }
}

# IAM Roles and Policies
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "agri-fi-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "agri-fi-ecs-task-execution-role"
    Project = "agri-fi"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_policy" {
  name = "agri-fi-ecs-task-execution-policy"
  role = aws_iam_role.ecs_task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_user.arn,
          aws_secretsmanager_secret.db_password.arn,
          aws_secretsmanager_secret.jwt_secret.arn,
          aws_secretsmanager_secret.stellar_secret.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.ecs_logs.arn}:*"
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task_role" {
  name = "agri-fi-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "agri-fi-ecs-task-role"
    Project = "agri-fi"
  }
}

resource "aws_iam_role_policy" "ecs_task_policy" {
  name = "agri-fi-ecs-task-policy"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.kyc_documents.arn}/*"
      }
    ]
  })
}

# Secrets Manager
resource "aws_secretsmanager_secret" "db_user" {
  name = "agri-fi/db/username"

  tags = {
    Name    = "agri-fi-db-username"
    Project = "agri-fi"
  }
}

resource "aws_secretsmanager_secret_version" "db_user" {
  secret_id     = aws_secretsmanager_secret.db_user.id
  secret_string = jsonencode({ username = var.db_username })
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "agri-fi/db/password"

  tags = {
    Name    = "agri-fi-db-password"
    Project = "agri-fi"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({ password = var.db_password })
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "agri-fi/jwt/secret"

  tags = {
    Name    = "agri-fi-jwt-secret"
    Project = "agri-fi"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = jsonencode({ jwt_secret = var.jwt_secret })
}

resource "aws_secretsmanager_secret" "stellar_secret" {
  name = "agri-fi/stellar/secret"

  tags = {
    Name    = "agri-fi-stellar-secret"
    Project = "agri-fi"
  }
}

resource "aws_secretsmanager_secret_version" "stellar_secret" {
  secret_id     = aws_secretsmanager_secret.stellar_secret.id
  secret_string = jsonencode({ stellar_secret = var.stellar_platform_secret })
}

# ACM Certificate
resource "aws_acm_certificate" "agri_fi" {
  domain_name       = "agri-fi.example.com"
  validation_method = "DNS"

  subject_alternative_names = [
    "api.agri-fi.example.com"
  ]

  tags = {
    Name    = "agri-fi-cert"
    Project = "agri-fi"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Data source for current AWS region
data "aws_region" "current" {}

# Outputs
output "alb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.agri_fi.dns_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.agri_fi.name
}

output "backend_service_name" {
  description = "Name of the backend ECS service"
  value       = aws_ecs_service.backend.name
}

output "frontend_service_name" {
  description = "Name of the frontend ECS service"
  value       = aws_ecs_service.frontend.name
}
