# Terraform Drift Detection

`.github/workflows/terraform-drift.yml` runs `terraform plan -detailed-exitcode` for the AWS root stack and the GCP stack on infrastructure pull requests, nightly, and manual dispatch.

- Exit `0`: state matches the declared configuration.
- Exit `2`: Terraform found drift or planned changes. Scheduled and manual runs send a Slack alert; pull requests fail so the change is reviewed.
- Exit `1`: initialization or planning failed and must be repaired before merging.

The workflow requires remote, locked state. Configure `TF_AWS_STATE_BUCKET`, `TF_AWS_STATE_KEY`, `TF_GCP_STATE_BUCKET`, `TF_AWS_ROLE_ARN`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_TERRAFORM_SERVICE_ACCOUNT`, and `SLACK_WEBHOOK_URL` as repository or environment secrets. The AWS S3 backend and GCP GCS backend definitions are in the corresponding Terraform directories.

Do not auto-approve from this workflow. Apply only from the CD workflow after the normal manual approval gate. For an unexpected drift alert, capture the plan artifact, identify the manual change, and either reconcile it through Terraform or explicitly document the approved exception before applying.
