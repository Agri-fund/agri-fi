# Staging Environment Refresh Automation

The staging environment is automatically refreshed weekly with an anonymised production snapshot, followed by smoke tests and PII verification.

## Schedule

- **Automatic**: Every Sunday at 01:00 UTC (via `.github/workflows/staging-refresh.yml` schedule)
- **Manual trigger**: Run `staging-refresh.yml` workflow manually anytime via GitHub Actions UI with optional `force_refresh` flag

## Workflow Steps

1. **Download production backup** — Retrieves the latest production dump from S3
2. **Anonymise** — Runs `devops/scripts/anonymise-dump.ts` to replace PII:
   - Emails → `{first}.{last}{num}@example.com` (or test.org, sample.net, demo.io, staging.dev)
   - Phone numbers → Synthetic numbers with country codes (+1, +234, +254, +233, +27, +91, +55)
   - IP addresses → 127.0.0.x
   - Stellar addresses → Valid testnet format (G + 55 random chars)
   - KYC encrypted fields → NULL
3. **PII scan gate** — Verifies anonymisation with strict regex checks:
   - No real email domains (non-example)
   - No suspicious phone patterns
   - No private IP addresses (10.x, 172.16-31.x, 192.168.x)
   - No JWT/encrypted data tokens
   - **Fails if any PII detected** — blocks restore
4. **Restore** — Applies anonymised dump to staging database
5. **Smoke tests** — Validates staging readiness:
   - `/health` endpoint (with retries)
   - `/v1/prices/commodities`
   - `/v1/prices/fx`
   - `/v1/trade-deals` (paginated)
   - Seed user login (if credentials provided in secrets)
6. **Notifications** — Posts success/failure to Discord and Slack

## Configuration

Required GitHub secrets:

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 bucket access (backups) |
| `STAGING_DB_HOST`, `STAGING_DB_PORT`, `STAGING_DB_USER`, `STAGING_DB_PASSWORD`, `STAGING_DB_NAME` | Staging database connection |
| `STAGING_API_URL` | Base URL for smoke tests (default: https://api.staging.example.com) |
| `STAGING_SEED_EMAIL`, `STAGING_SEED_PASSWORD` | Seed user credentials for login test (optional) |
| `DISCORD_WEBHOOK_URL` | Discord notification endpoint (optional) |
| `SLACK_WEBHOOK_URL` | Slack notification endpoint (optional) |

Optional env vars in `staging-refresh.yml`:

```yaml
STAGING_S3_BUCKET: 'agrifi-staging-dumps'          # S3 bucket for backups
STAGING_S3_PREFIX: 'weekly-snapshots'                # S3 prefix for anonymised dumps
AWS_REGION: 'us-east-1'                             # AWS region
```

## Manual Trigger

```bash
# Via GitHub CLI
gh workflow run staging-refresh.yml --ref main

# Or via GitHub UI
1. Navigate to Actions → Staging Environment Refresh
2. Click "Run workflow"
3. (Optional) Enable "Force staging refresh" to skip recent-refresh checks
4. Click "Run workflow"
```

## Troubleshooting

**PII scan failed — real emails detected**
- The anonymisation regex didn't catch all PII. Review the `devops/scripts/anonymise-dump.ts` rules and update them.
- Check the workflow logs for the specific pattern that failed.

**Smoke tests failed**
- Ensure staging API is deployed and reachable at `STAGING_API_URL`
- Check staging database logs for migration or connection errors
- Verify seed user credentials are correct in GitHub secrets (if testing login)

**Restore failed**
- Verify staging database credentials and network connectivity
- Check S3 dump file integrity: `aws s3 ls s3://${STAGING_S3_BUCKET}/${STAGING_S3_PREFIX}/`
- Ensure anonymised dump was compressed correctly: `file /tmp/anonymised-dump.sql.gz`

## Anonymisation Rules Reference

| Field | Original → Anonymised | Example |
|---|---|---|
| email | `john.doe@acme.com` → `amara.mensah1234@example.com` | Random name + domain |
| phone | `+14155551234` → `+2348012345678` | Random number, country code preserved |
| ip_address | `192.168.1.100` → `127.0.0.42` | Sequential 127.0.0.x |
| stellar_addr | `GAZQGKXYLG2S5JXQLK7...` → `GBCDABCDABCDABCDABCD...` | Valid testnet format |
| kyc_encrypted | Base64 blob → `NULL` | Sensitive data wiped |

## Related

- `.github/workflows/staging-refresh.yml` — Refresh automation workflow
- `.github/workflows/staging-pii-scan.yml` — PII anonymisation verification (runs on PR changes)
- `devops/scripts/anonymise-dump.ts` — Anonymisation script
- `docs/gitops-argocd.md` — ArgoCD/GitOps deployment model
