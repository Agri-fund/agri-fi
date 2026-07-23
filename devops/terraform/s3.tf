# S3 bucket for storing user KYC documents, configured with lifecycle rules
# to transition older documents to Standard-IA and Glacier to reduce storage costs.

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

  rule {
    id     = "transition-to-standard-ia-and-glacier"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }
}
