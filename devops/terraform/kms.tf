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
