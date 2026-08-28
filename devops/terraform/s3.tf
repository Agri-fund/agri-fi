# S3 bucket for storing user KYC documents, configured with lifecycle rules
# to transition older documents to Standard-IA and Glacier to reduce storage costs.
# Cost optimization: Documents > 2 years transition to Glacier Instant Retrieval (~90% cheaper than Standard)
# Expiry: 7 years for regulatory compliance (GDPR, KYC retention requirements)

resource "aws_s3_bucket" "kyc_documents" {
  bucket = "agrifi-kyc-documents"

  tags = {
    Name    = "agrifi-kyc-documents"
    Project = "agri-fi"
  }
}

resource "aws_s3_bucket_versioning" "kyc_versioning" {
  bucket = aws_s3_bucket.kyc_documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kyc_encryption" {
  bucket = aws_s3_bucket.kyc_documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "kyc_lifecycle" {
  bucket = aws_s3_bucket.kyc_documents.id

  # Lifecycle rule for current and non-current object versions
  rule {
    id     = "current-version-transitions"
    status = "Enabled"

    # Transition to Standard-IA after 90 days for less frequent access
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    # Transition to Glacier Instant Retrieval after 2 years (730 days)
    # Glacier Instant Retrieval: ~90% cheaper than Standard, instant access (milliseconds)
    transition {
      days          = 730
      storage_class = "GLACIER_IR"
    }

    # Expire (permanently delete) after 7 years (2555 days) for regulatory compliance
    expiration {
      days = 2555
    }
  }

  # Lifecycle rule for non-current object versions (from versioning)
  noncurrent_version_transition {
    noncurrent_days = 90
    storage_class   = "STANDARD_IA"
  }

  noncurrent_version_transition {
    noncurrent_days = 730
    storage_class   = "GLACIER_IR"
  }

  noncurrent_version_expiration {
    noncurrent_days = 2555
  }

  depends_on = [aws_s3_bucket_versioning.kyc_versioning]
}

# S3 bucket access logging for audit trail
resource "aws_s3_bucket_logging" "kyc_logging" {
  bucket = aws_s3_bucket.kyc_documents.id

  target_bucket = aws_s3_bucket.kyc_documents.id
  target_prefix = "access-logs/"
}

# Block public access to ensure documents remain private
resource "aws_s3_bucket_public_access_block" "kyc_public_access_block" {
  bucket = aws_s3_bucket.kyc_documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

