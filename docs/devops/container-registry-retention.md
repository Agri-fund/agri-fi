# Container Registry Lifecycle & Tag Retention Policy

To optimize cloud costs and prevent container image bloat, Agri-Fi enforces strict tag-retention policies across all container registries (ECR / GHCR).

## Retention Rules

1. **Untagged Images**: Automatically purged after 7 days (`sinceImagePushed: 7 days`).
2. **Development / Staging Tags (`dev-*`, `stage-*`)**: Retain the latest 30 images; older images expire automatically.
3. **Production / Release Tags (`v*`, `prod-*`)**: Retain the latest 100 images for rollback safety.

## Automation & Monitoring

- ECR lifecycle rules are provisioned via Terraform (`devops/terraform/ecr-lifecycle.json`).
- Scheduled GC cron runs weekly (`.github/workflows/registry-gc.yml`) executing `devops/scripts/prune-registry.sh`.
