# Agri-Fi GitOps with ArgoCD

This repository follows the GitOps pattern using ArgoCD for Kubernetes deployment automation.

## Architecture

1. **Git Repository as Source of Truth**: All Kubernetes manifests live in `devops/k8s/`.
2. **CI Pipeline**: On push to `main`, GitHub Actions builds container images, updates the image tag in `devops/k8s/`, and commits back to the repo.
3. **ArgoCD Controller**: Detects git commits, compares cluster live state against the Git manifest, and synchronizes state.
4. **Secrets Management**: Managed via Bitnami Sealed Secrets (`devops/k8s/argocd/sealed-secrets.yaml`) or External Secrets Operator.

## Automated Rollback Procedure

To roll back a bad deployment:
```bash
git revert HEAD
git push origin main
```
ArgoCD detects the revert commit and automatically transitions the Kubernetes cluster back to the previous stable state.

## SealedSecret drift detection

The repo includes a read-only drift check for SealedSecrets so cluster drift is caught before it reaches production. The check decrypts the sealed manifest locally using the SealedSecrets private key, reads the expected values from Vault or a JSON file, and then reports any value mismatch plus a `kubectl diff` artifact.

```bash
# Vault-backed check
export VAULT_ADDR="https://vault.example.com"
export VAULT_TOKEN="..."
export SEALED_SECRET_PRIVATE_KEY_PATH="/path/to/sealed-secrets.key"
export VAULT_PATH="secret/data/agri-fi/app"
./devops/scripts/backup-and-restore-argocd.sh drift-check

# Or compare against a JSON file of expected values
export SEALED_SECRET_PRIVATE_KEY_PATH="/path/to/sealed-secrets.key"
export EXPECTED_SECRET_VALUES_FILE="/tmp/expected-secrets.json"
./devops/scripts/sealed-secret-drift-check.sh --sealed-file devops/k8s/argocd/sealed-secrets.yaml --namespace agri-fi --secret-name agri-fi-secrets
```

Behavior:
- No mutation is performed by default.
- On mismatch, the script writes a report under `/tmp/sealed-secret-drift` and can send a Slack alert via `SLACK_WEBHOOK_URL`.
- The script exits non-zero so CI or a cron job can fail the pipeline.

Example cron entry (daily at 06:00 UTC):
```cron
0 6 * * * /workspace/agri-fi/devops/scripts/backup-and-restore-argocd.sh drift-check >/var/log/agri-fi-sealed-secret-drift.log 2>&1
```

## Re-sealing and rotation workflow

When a secret value is rotated in Vault / KMS or a manual `kubectl edit` drifts away from the approved value:

1. Confirm the current value in Vault or the rotation source.
2. Re-seal the target manifest with the cluster controller key:
   ```bash
   kubeseal --format yaml --cert /path/to/sealed-secrets-cert.pem \
     < secret.yaml > devops/k8s/argocd/sealed-secrets.yaml
   ```
3. Review the diff before merge:
   ```bash
   git diff -- devops/k8s/argocd/sealed-secrets.yaml
   ```
4. Apply the re-sealed manifest explicitly:
   ```bash
   kubectl apply -f devops/k8s/argocd/sealed-secrets.yaml
   ```
5. Run the drift check again to confirm the cluster matches the approved value set.

This keeps SealedSecret drift clearly visible while preserving the “detect-only unless approved” safety model.
