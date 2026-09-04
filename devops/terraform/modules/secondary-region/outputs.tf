# Outputs from the secondary-region warm standby module (#903).
# Consumed by devops/terraform/dr.tf and by the disaster-recovery.sh script
# (via `terraform output -raw`).

output "secondary_rds_identifier" {
  description = "DB instance identifier of the secondary RDS read replica. Pass to disaster-recovery.sh as SECONDARY_RDS_IDENTIFIER."
  value       = aws_db_instance.secondary_replica.identifier
}

output "secondary_ecs_cluster_arn" {
  description = "ARN of the secondary ECS cluster. Used by the DR script to scale up the backend service on failover."
  value       = aws_ecs_cluster.secondary.arn
}

output "secondary_ecs_cluster_name" {
  description = "Name of the secondary ECS cluster (convenience alias for aws ecs CLI calls)."
  value       = aws_ecs_cluster.secondary.name
}

output "secondary_redis_endpoint" {
  description = "Primary endpoint address of the secondary ElastiCache Redis replication group."
  value       = aws_elasticache_replication_group.secondary.primary_endpoint_address
}

output "route53_health_check_id" {
  description = "ID of the Route53 HTTPS health check monitoring the primary endpoint. Referenced by CloudWatch alarms and the DR drill status check."
  value       = aws_route53_health_check.primary.id
}

output "secondary_alb_dns_name" {
  description = "DNS name of the secondary region Application Load Balancer."
  value       = aws_lb.secondary.dns_name
}

output "secondary_vpc_id" {
  description = "VPC ID of the secondary region network."
  value       = aws_vpc.secondary.id
}

output "secondary_rds_endpoint" {
  description = "Connection endpoint (host:port) for the secondary RDS instance. After promotion, point DATABASE_HOST here."
  value       = aws_db_instance.secondary_replica.endpoint
}
