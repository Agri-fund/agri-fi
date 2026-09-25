resource "aws_kms_key" "compliance_rotation" {
  description             = "Compliance-managed KMS key with automatic rotation"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "compliance-rotation-key"
  }
}

resource "aws_kms_alias" "compliance_rotation" {
  name          = "alias/compliance-rotation-key"
  target_key_id = aws_kms_key.compliance_rotation.key_id
}

# KMS key for encrypting RDS credentials stored in Secrets Manager (#852)

resource "aws_kms_key" "rds_credentials" {
  description             = "Encrypts RDS credentials in Secrets Manager"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "${var.project}-rds-credentials-key"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "rds_credentials" {
  name          = "alias/${var.project}/rds-credentials"
  target_key_id = aws_kms_key.rds_credentials.key_id
}

# CloudWatch alarm — alert if KMS key is disabled or scheduled for deletion
resource "aws_cloudwatch_metric_alarm" "kms_key_disabled" {
  alarm_name          = "${var.project}-kms-rds-key-disabled"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "NumberOfRequestsWithKeyId"
  namespace           = "AWS/KMS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when RDS KMS key is disabled or pending deletion"

  dimensions = {
    KeyId = aws_kms_key.rds_credentials.key_id
  }

  alarm_actions = [var.sns_alert_arn]
}

output "rds_kms_key_arn" {
  value       = aws_kms_key.rds_credentials.arn
  description = "ARN of the KMS key used to encrypt RDS credentials"
}
