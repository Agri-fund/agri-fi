resource "aws_iam_role" "eks_cluster" {
  provider = aws.secondary
  name     = "${var.name}-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  provider   = aws.secondary
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "standby" {
  provider = aws.secondary
  name     = "${var.name}-standby"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = var.cluster_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = false
  }

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster]

  tags = {
    Name      = "${var.name}-standby"
    ManagedBy = "Terraform"
  }
}

resource "aws_eks_access_entry" "failover" {
  provider      = aws.secondary
  cluster_name  = aws_eks_cluster.standby.name
  principal_arn = var.failover_role_arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "failover_admin" {
  provider      = aws.secondary
  cluster_name  = aws_eks_cluster.standby.name
  principal_arn = aws_eks_access_entry.failover.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

resource "aws_iam_role" "eks_nodes" {
  provider = aws.secondary
  name     = "${var.name}-eks-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_nodes" {
  provider = aws.secondary
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])

  role       = aws_iam_role.eks_nodes.name
  policy_arn = each.value
}

resource "aws_eks_node_group" "standby" {
  provider        = aws.secondary
  cluster_name    = aws_eks_cluster.standby.name
  node_group_name = "${var.name}-standby-workers"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.node_subnet_ids
  instance_types  = var.node_instance_types
  capacity_type   = var.node_capacity_type

  scaling_config {
    min_size     = 0
    desired_size = 0
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [aws_iam_role_policy_attachment.eks_nodes]

  tags = {
    Name      = "${var.name}-standby-workers"
    ManagedBy = "Terraform"
  }
}

resource "aws_db_subnet_group" "standby" {
  provider   = aws.secondary
  name       = "${var.name}-standby-db"
  subnet_ids = var.database_subnet_ids
}

resource "aws_security_group" "standby_database" {
  provider    = aws.secondary
  name        = "${var.name}-standby-db"
  description = "PostgreSQL ingress from the standby EKS cluster"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from standby application subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.backend_subnet_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "standby_replica" {
  provider               = aws.secondary
  identifier             = "${var.name}-standby-postgres"
  replicate_source_db    = var.primary_rds_arn
  instance_class         = var.database_instance_class
  kms_key_id             = var.database_kms_key_arn
  db_subnet_group_name   = aws_db_subnet_group.standby.name
  vpc_security_group_ids = [aws_security_group.standby_database.id]
  publicly_accessible    = false
  apply_immediately      = true
  deletion_protection    = true

  lifecycle {
    ignore_changes = [replicate_source_db]
  }

  tags = {
    Name      = "${var.name}-standby-postgres"
    ManagedBy = "Terraform"
  }
}

resource "aws_cloudwatch_metric_alarm" "standby_rds_replica_lag" {
  provider            = aws.secondary
  alarm_name          = "${var.name}-standby-rds-replica-lag"
  alarm_description   = "Standby PostgreSQL replication lag exceeded the one-minute RPO target"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 60
  alarm_actions       = [var.secondary_sns_topic_arn]
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.standby_replica.id
  }
}

resource "aws_elasticache_global_replication_group" "global" {
  provider                           = aws.primary
  global_replication_group_id_suffix = var.redis_global_id_suffix
  primary_replication_group_id       = var.primary_redis_replication_group_id
  automatic_failover_enabled         = true
}

resource "aws_elasticache_replication_group" "standby_redis" {
  provider                    = aws.secondary
  replication_group_id        = "${var.name}-standby-redis"
  description                 = "Agri-Fi warm standby Redis Global Datastore"
  global_replication_group_id = aws_elasticache_global_replication_group.global.global_replication_group_id
  engine                      = "redis"
  engine_version              = var.redis_engine_version
  node_type                   = var.redis_node_type
  num_cache_clusters          = var.redis_num_cache_clusters
  automatic_failover_enabled  = true
  multi_az_enabled            = true
  transit_encryption_enabled  = true
  at_rest_encryption_enabled  = true
  subnet_group_name           = var.redis_subnet_group_name
  security_group_ids          = var.redis_security_group_ids
  apply_immediately           = true

  tags = {
    Name      = "${var.name}-standby-redis"
    ManagedBy = "Terraform"
  }
}

resource "aws_route53_health_check" "primary_api" {
  provider          = aws.primary
  fqdn              = var.primary_api_hostname
  port              = 443
  type              = "HTTPS"
  resource_path     = var.primary_healthcheck_path
  request_interval  = 30
  failure_threshold = 10

  tags = {
    Name      = "${var.name}-primary-api"
    ManagedBy = "Terraform"
  }
}

resource "aws_cloudwatch_metric_alarm" "primary_unhealthy" {
  provider            = aws.primary
  alarm_name          = "${var.name}-primary-api-unhealthy"
  alarm_description   = "Primary API health check has failed for five minutes"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = aws_route53_health_check.primary_api.id
  }
}