# Remote state: S3 bucket + DynamoDB lock table (Issue #1031)
#
# Run `terraform init -reconfigure` after merging this change.
# The S3 bucket and DynamoDB table must exist before init; create them once
# with the bootstrap module:
#
#   cd devops/terraform/bootstrap && terraform init && terraform apply
#
# Required env vars (or set AWS_PROFILE):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
terraform {
  backend "s3" {
    bucket         = "agrifi-terraform-state"
    key            = "envs/staging/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "alias/agrifi-terraform-state"

    # DynamoDB table for state locking — prevents concurrent applies from
    # corrupting the state file.
    dynamodb_table = "agrifi-terraform-state-lock"
  }
}
