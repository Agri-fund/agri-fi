# Terraform outputs exposed for downstream modules and CI/CD pipelines.

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

output "redis_primary_endpoint_address" {
  description = "DNS hostname of the Redis primary endpoint."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "Port on which the Redis cluster listens (always 6379)."
  value       = aws_elasticache_replication_group.redis.port
}

output "redis_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Redis AUTH token and TLS URL."
  value       = aws_secretsmanager_secret.redis_credentials.arn
}

output "redis_cluster_id" {
  description = "ID of the ElastiCache Redis replication group (cluster identifier)."
  value       = aws_elasticache_replication_group.redis.id
}

output "redis_replication_group_arn" {
  description = "ARN of the ElastiCache Redis replication group. Used by downstream modules for IAM policies and monitoring."
  value       = aws_elasticache_replication_group.redis.arn
}
