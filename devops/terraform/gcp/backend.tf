# Remote state: GCS bucket (Issue #1031)
#
# Run `terraform init -reconfigure` after merging this change.
# The GCS bucket must exist before init; create it once:
#
#   gsutil mb -p <PROJECT_ID> -l us-central1 gs://agrifi-terraform-state-gcp
#   gsutil versioning set on gs://agrifi-terraform-state-gcp
#
# GCS provides native object locking — no separate lock table required.
# Authentication: set GOOGLE_APPLICATION_CREDENTIALS or use Workload Identity.
terraform {
  backend "gcs" {
    bucket = "agrifi-terraform-state-gcp"
    prefix = "envs/staging"
  }
}
