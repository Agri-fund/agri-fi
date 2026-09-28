# PostgreSQL 17 Upgrade Verification

## CI gate

`backend-ci.yml` and `ci.yml` run migrations and the backend suite against PostgreSQL 16 and 17. A PostgreSQL 17 failure blocks the roll. The local Compose service and the GCP Cloud SQL definition target PostgreSQL 17 after this verification change.

## Staging dump and restore

The scheduled staging refresh downloads the latest production-shaped backup, anonymises it, and restores it with the PostgreSQL 17 client image. The restore uses `ON_ERROR_STOP` and then checks representative tables, installed extensions, and row-level-security-enabled tables. The manual `postgres-17-staging-restore.yml` workflow performs a custom-format `pg_dump` and `pg_restore` rehearsal with PostgreSQL 17 binaries; its source must be a prod-shaped, approved non-production dataset.

Required staging secrets are documented by the workflow: `STAGING_DB_HOST`, `STAGING_DB_PORT`, `STAGING_DB_USER`, `STAGING_DB_PASSWORD`, `STAGING_DB_NAME`, and the S3/AWS credentials. Run it manually with `force_refresh=true` after the staging database snapshot is confirmed.

For a local rehearsal:

```sh
pg_dump --format=custom "$PROD_DATABASE_URL" > /tmp/agri-fi.pgdump
PGPASSWORD="$STAGING_DB_PASSWORD" pg_restore --clean --if-exists --no-owner \
  --host="$STAGING_DB_HOST" --username="$STAGING_DB_USER" \
  --dbname="$STAGING_DB_NAME" /tmp/agri-fi.pgdump
psql "$STAGING_DATABASE_URL" -c 'SELECT extname FROM pg_extension ORDER BY extname;'
psql "$STAGING_DATABASE_URL" -c 'SELECT COUNT(*) FROM pg_class WHERE relrowsecurity;'
```

Run the backend smoke suite against the restored staging endpoint, including authentication, a read-only public query, an RLS-protected query, and one representative funding batch query. Do not use production credentials in the rehearsal.

## Rollout and rollback

1. Take and retain an RDS/Cloud SQL snapshot immediately before the maintenance window.
2. Confirm CI and staging restore are green, then upgrade the staging instance first.
3. Run migrations and the smoke suite, then promote the same engine version in production.
4. If validation fails, stop application writes, restore the pre-upgrade snapshot to a new instance, verify row counts/extensions/RLS, and switch the database endpoint back through the deployment secret.
5. Keep the original snapshot until application validation and the rollback window are closed. A rollback is a snapshot restore with `pg_restore` used only for logical backup recovery, not an in-place downgrade.
