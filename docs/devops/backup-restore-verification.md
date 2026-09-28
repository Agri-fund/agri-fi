# Automated Backup Restore Verification

Backups are only as reliable as their last successful restoration. Agri-Fi runs automated weekly restore drills against disposable staging databases.

## Guardrails
- **Zero Production Blast Radius**: Restores run strictly against isolated, ephemeral RDS / PostgreSQL instances.
- **Automated Alerts**: Failures immediately ping the on-call channel via Slack and PagerDuty.
- **Integrity Validation**: The script validates row counts, table checksums, and schema migrations post-restore.
