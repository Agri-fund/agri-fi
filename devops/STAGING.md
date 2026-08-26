# Staging Environment Configuration

## Overview

The staging environment mirrors production with anonymised data, providing a realistic testing ground without exposing real PII.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `STAGING_DB_HOST` | PostgreSQL host | `staging-db.agric-onchain.com` |
| `STAGING_DB_PORT` | PostgreSQL port | `5432` |
| `STAGING_DB_USER` | Database user | `agric_staging` |
| `STAGING_DB_NAME` | Database name | `agric_onchain_staging` |
| `STAGING_DB_PASSWORD` | Database password | (secret) |
| `STAGING_S3_BUCKET` | S3 bucket for dumps | `agrifi-staging-dumps` |
| `STAGING_S3_PREFIX` | S3 key prefix | `weekly-snapshots` |

## GitHub Actions Secrets

Configure these secrets in your repository settings:

```
STAGING_DB_HOST
STAGING_DB_PORT
STAGING_DB_USER
STAGING_DB_NAME
STAGING_DB_PASSWORD
STAGING_S3_BUCKET
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
STAGING_WEBHOOK_URL (optional - for Slack/Discord notifications)
```

## Data Anonymisation Rules

The `devops/scripts/anonymise-dump.ts` script applies the following transformations:

| Field | Transformation | Example |
|-------|---------------|---------|
| `user.email` | Replaced with synthetic email | `amara.mensah42@example.com` |
| `user.firstName` | Replaced with random first name | `Kofi` |
| `user.lastName` | Replaced with random last name | `Okafor` |
| `kyc.*` encrypted columns | Set to NULL | `NULL` |
| Wallet addresses | Replaced with valid testnet addresses | `GAB2...` (56 chars) |
| IP addresses | Replaced with `127.0.0.x` | `127.0.0.1` |
| Phone numbers | Replaced with synthetic numbers | `+254712345678` |

## Refresh Schedule

- **Automated**: Every Sunday at 01:00 UTC via GitHub Actions
- **Manual**: Trigger via `workflow_dispatch` with optional `force_refresh` flag

## Rollback

If the snapshot fails, staging can be re-seeded from the seed script:

```bash
cd backend
STAGING_DATABASE_URL=your_staging_url npm run db:seed
```

## Local Development

To use anonymised data locally:

```bash
# Download latest anonymised dump from S3
aws s3 cp s3://agrifi-staging-dumps/weekly-snapshots/latest.sql.gz /tmp/

# Restore to local PostgreSQL
gunzip /tmp/latest.sql.gz
pg_restore --localhost --username=postgres --dbname=agric_dev /tmp/latest.sql
```

## Monitoring

- Grafana dashboard includes staging-specific panels
- Prometheus scrapes staging backend metrics
- Sentry environment tag: `staging`

## Security Notes

- No real PII exists in staging after anonymisation
- Automated scan verifies no email patterns remain post-anonymisation
- Staging uses separate AWS credentials with limited permissions
- Database encryption at rest enabled via AWS KMS
