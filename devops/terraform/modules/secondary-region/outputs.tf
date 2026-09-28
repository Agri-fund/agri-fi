output "eks_cluster_name" {
  description = "Name of the standby EKS cluster."
  value       = aws_eks_cluster.standby.name
}

output "eks_nodegroup_name" {
  description = "Name of the zero-capacity standby EKS node group."
  value       = aws_eks_node_group.standby.node_group_name
}

output "rds_replica_id" {
  description = "Identifier of the cross-region PostgreSQL replica."
  value       = aws_db_instance.standby_replica.identifier
}

output "rds_replica_endpoint" {
  description = "Endpoint to configure after promoting the PostgreSQL replica."
  value       = aws_db_instance.standby_replica.endpoint
}

output "redis_global_replication_group_id" {
  description = "Redis Global Datastore identifier shared across both regions."
  value       = aws_elasticache_global_replication_group.global.global_replication_group_id
}

output "redis_standby_endpoint" {
  description = "Secondary Redis replication-group primary endpoint."
  value       = aws_elasticache_replication_group.standby_redis.primary_endpoint_address
}

output "primary_api_health_check_id" {
  description = "Route 53 health check ID for the primary API."
  value       = aws_route53_health_check.primary_api.id
}

output "primary_unhealthy_alarm_arn" {
  description = "CloudWatch alarm ARN for five consecutive unhealthy minutes."
  value       = aws_cloudwatch_metric_alarm.primary_unhealthy.arn
}

output "standby_rds_replica_lag_alarm_arn" {
  description = "CloudWatch alarm ARN for standby PostgreSQL lag over 60 seconds."
  value       = aws_cloudwatch_metric_alarm.standby_rds_replica_lag.arn
}