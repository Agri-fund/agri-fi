# Bootstrap module — creates the S3 bucket and DynamoDB table that
# devops/terraform/backend.tf depends on (Issue #1031).
#
# Run this ONCE before running `terraform init` in the parent config:
#
#   cd devops/terraform/bootstrap
#   terraform init
#   terraform apply
#
# This module uses local state intentionally — it is the chicken-and-egg
# layer that must exist before remote state is configured. Commit the
# resulting terraform.tfstate only for the bootstrap module, or store it
# manually in a secure location.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for the state bucket and lock table."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project prefix used in resource names."
  type        = string
  default     = "agrifi"
}

# ── S3 state bucket ──────────────────────────────────────────────────────────

resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-terraform-state"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name    = "${var.project_name}-terraform-state"
    Purpose = "terraform-remote-state"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.terraform_state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── KMS key for state encryption ─────────────────────────────────────────────

resource "aws_kms_key" "terraform_state" {
  description             = "KMS key for Terraform remote state encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name    = "${var.project_name}-terraform-state"
    Purpose = "terraform-remote-state"
  }
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/${var.project_name}-terraform-state"
  target_key_id = aws_kms_key.terraform_state.key_id
}

# ── DynamoDB lock table ───────────────────────────────────────────────────────

resource "aws_dynamodb_table" "terraform_state_lock" {
  name         = "${var.project_name}-terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name    = "${var.project_name}-terraform-state-lock"
    Purpose = "terraform-state-locking"
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "state_bucket_name" {
  description = "Name of the S3 bucket holding Terraform state."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "Name of the DynamoDB table used for state locking."
  value       = aws_dynamodb_table.terraform_state_lock.name
}

output "kms_key_alias" {
  description = "KMS key alias used to encrypt state objects."
  value       = aws_kms_alias.terraform_state.name
}
