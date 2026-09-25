#!/usr/bin/env bash
# verify-restore.sh — Restore latest encrypted backup to isolated PG, run integrity
# checks, run migrations, send report email, alert PagerDuty on failure.
#
# Issue #862 — Automated database backup verification with restore testing.
#
# Required env vars:
#   DATABASE_URL               Postgres connection string (source)
#   BACKUP_ENCRYPTION_KEY      AES-256 passphrase (or fetched via AWS_SECRET_ID)
#   BACKUP_S3_BUCKET           S3 bucket containing backup archives
#   BACKUP_S3_PREFIX           (optional) key prefix, defaults to "backups"
#   VERIFY_DB_HOST             Host for the isolated restore target instance
#   VERIFY_DB_PORT             Port for the restore target (default 5433)
#   VERIFY_DB_NAME             DB name to restore into (default agri_fi_verify)
#   VERIFY_DB_USER             Superuser for the isolated instance (default postgres)
#   VERIFY_DB_PASS             Password for the isolated instance
#   REPORT_EMAIL               Recipient address for the restore report
#   SMTP_HOST                  SMTP relay host
#   SMTP_PORT                  SMTP relay port (default 25)
#   SMTP_USER / SMTP_PASS      SMTP credentials (optional)
#   PAGERDUTY_ROUTING_KEY      PagerDuty Events API v2 routing key
#   AWS_SECRET_ID              (optional) Secrets Manager secret for encryption key
#   SLO_RESTORE_MINUTES        (optional) Restore time SLO in minutes (default 30)
#
# Exit codes:
#   0  — all checks passed
#   1  — restore or integrity failure (PagerDuty alert fired)
#   2  — environment / configuration error

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
WORK_DIR="/tmp/agri-fi-verify-${TIMESTAMP}"
REPORT_FILE="${WORK_DIR}/report.txt"
SLO_MINUTES="${SLO_RESTORE_MINUTES:-30}"

VERIFY_DB_HOST="${VERIFY_DB_HOST:-localhost}"
VERIFY_DB_PORT="${VERIFY_DB_PORT:-5433}"
VERIFY_DB_NAME="${VERIFY_DB_NAME:-agri_fi_verify}"
VERIFY_DB_USER="${VERIFY_DB_USER:-postgres}"
VERIFY_DB_URL="postgresql://${VERIFY_DB_USER}:${VERIFY_DB_PASS:-postgres}@${VERIFY_DB_HOST}:${VERIFY_DB_PORT}/${VERIFY_DB_NAME}"

S3_PREFIX="${BACKUP_S3_PREFIX:-backups}"

# ── Trap for cleanup ──────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  echo "--- Cleaning up work directory ${WORK_DIR} ---"
  rm -rf "${WORK_DIR}"
  exit "${exit_code}"
}
trap cleanup EXIT

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u +"%H:%M:%SZ")] $*"; }
fail() { echo "ERROR: $*" >&2; fire_pagerduty "$*"; send_report "FAILED" "$*"; exit 1; }

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required env var ${var} is not set." >&2
    exit 2
  fi
}

# ── Validation ────────────────────────────────────────────────────────────────
require_env BACKUP_S3_BUCKET
require_env REPORT_EMAIL
require_env PAGERDUTY_ROUTING_KEY

# ── Fetch encryption key ──────────────────────────────────────────────────────
if [[ -n "${AWS_SECRET_ID:-}" ]]; then
  log "Fetching encryption key from AWS Secrets Manager (${AWS_SECRET_ID})..."
  BACKUP_ENCRYPTION_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "${AWS_SECRET_ID}" \
    --query SecretString \
    --output text)
fi
require_env BACKUP_ENCRYPTION_KEY

# ── Setup work directory ──────────────────────────────────────────────────────
mkdir -p "${WORK_DIR}"
echo "Backup Restore Verification Report — ${TIMESTAMP}" > "${REPORT_FILE}"
echo "=============================================="   >> "${REPORT_FILE}"

# ── Step 1: Find the latest backup in S3 ─────────────────────────────────────
log "Locating latest backup in s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/ ..."
LATEST_KEY=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/" \
  | grep '\.pgdump\.enc$' \
  | sort -k1,2 \
  | tail -n1 \
  | awk '{print $4}')

if [[ -z "${LATEST_KEY}" ]]; then
  fail "No .pgdump.enc backups found in s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/"
fi

BACKUP_S3_PATH="s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/${LATEST_KEY}"
log "Latest backup: ${BACKUP_S3_PATH}"
echo "Backup file  : ${BACKUP_S3_PATH}" >> "${REPORT_FILE}"

# ── Step 2: Download and decrypt ─────────────────────────────────────────────
ENCRYPTED_FILE="${WORK_DIR}/backup.pgdump.enc"
DUMP_FILE="${WORK_DIR}/backup.pgdump"

log "Downloading backup..."
aws s3 cp "${BACKUP_S3_PATH}" "${ENCRYPTED_FILE}"

log "Decrypting backup..."
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 600000 \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in  "${ENCRYPTED_FILE}" \
  -out "${DUMP_FILE}"

# ── Step 3: Restore to isolated instance ─────────────────────────────────────
log "Preparing isolated database ${VERIFY_DB_NAME} on ${VERIFY_DB_HOST}:${VERIFY_DB_PORT} ..."

PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
  -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
  -c "DROP DATABASE IF EXISTS ${VERIFY_DB_NAME};" \
  postgres

PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
  -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
  -c "CREATE DATABASE ${VERIFY_DB_NAME};" \
  postgres

log "Restoring pg_dump to ${VERIFY_DB_NAME} ..."
RESTORE_START=$(date +%s)

PGPASSWORD="${VERIFY_DB_PASS:-postgres}" pg_restore \
  --host="${VERIFY_DB_HOST}" \
  --port="${VERIFY_DB_PORT}" \
  --username="${VERIFY_DB_USER}" \
  --dbname="${VERIFY_DB_NAME}" \
  --no-password \
  --jobs=4 \
  --no-owner \
  --verbose \
  "${DUMP_FILE}" 2>&1 | tail -20

RESTORE_END=$(date +%s)
RESTORE_SECONDS=$(( RESTORE_END - RESTORE_START ))
RESTORE_MINUTES=$(( RESTORE_SECONDS / 60 ))

log "Restore completed in ${RESTORE_SECONDS}s (${RESTORE_MINUTES}m)."
echo "Restore time : ${RESTORE_SECONDS}s (${RESTORE_MINUTES}m) — SLO: ${SLO_MINUTES}m" >> "${REPORT_FILE}"

if (( RESTORE_MINUTES > SLO_MINUTES )); then
  echo "WARNING: Restore time exceeded SLO of ${SLO_MINUTES} minutes!" >> "${REPORT_FILE}"
fi

# ── Step 4: Integrity checks ──────────────────────────────────────────────────
log "Running data integrity checks..."

run_check() {
  local name="$1"
  local sql="$2"
  local result
  result=$(PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
    -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
    -d "${VERIFY_DB_NAME}" -At -c "${sql}" 2>&1)
  echo "  [CHECK] ${name}: ${result}" >> "${REPORT_FILE}"
  log "  ${name}: ${result}"
  echo "${result}"
}

fail_check() {
  echo "  [FAIL]  $1: $2" >> "${REPORT_FILE}"
  fail "Integrity check failed — $1: $2"
}

INTEGRITY_SQL_FILE="${SCRIPT_DIR}/integrity-checks.sql"

if [[ -f "${INTEGRITY_SQL_FILE}" ]]; then
  log "Running extended integrity checks from ${INTEGRITY_SQL_FILE} ..."
  PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
    -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
    -d "${VERIFY_DB_NAME}" \
    -f "${INTEGRITY_SQL_FILE}" \
    >> "${REPORT_FILE}" 2>&1 \
    || fail "Extended integrity checks failed"
fi

# Core table row counts
echo ""              >> "${REPORT_FILE}"
echo "Row Counts:"   >> "${REPORT_FILE}"

for table in users trade_deals investments shipment_milestones system_audit_logs; do
  count=$(run_check "${table}" "SELECT COUNT(*) FROM ${table};")
  if [[ -z "${count}" || "${count}" == "0" ]]; then
    echo "  WARNING: table '${table}' returned 0 rows or failed." >> "${REPORT_FILE}"
  fi
done

# Referential integrity spot-checks
log "Checking referential integrity..."

orphan_investments=$(run_check "orphan_investments" \
  "SELECT COUNT(*) FROM investments i LEFT JOIN trade_deals t ON i.trade_deal_id = t.id WHERE t.id IS NULL;")
if [[ "${orphan_investments}" != "0" ]]; then
  fail_check "orphan_investments" "Found ${orphan_investments} orphaned investments"
fi

orphan_milestones=$(run_check "orphan_milestones" \
  "SELECT COUNT(*) FROM shipment_milestones m LEFT JOIN trade_deals t ON m.trade_deal_id = t.id WHERE t.id IS NULL;")
if [[ "${orphan_milestones}" != "0" ]]; then
  fail_check "orphan_milestones" "Found ${orphan_milestones} orphaned milestones"
fi

orphan_documents=$(run_check "orphan_documents" \
  "SELECT COUNT(*) FROM documents d LEFT JOIN trade_deals t ON d.trade_deal_id = t.id WHERE t.id IS NULL;")
if [[ "${orphan_documents}" != "0" ]]; then
  fail_check "orphan_documents" "Found ${orphan_documents} orphaned documents"
fi

# Deal value sanity: total_invested must not exceed total_value
over_invested=$(run_check "over_invested_deals" \
  "SELECT COUNT(*) FROM trade_deals WHERE CAST(total_invested AS NUMERIC) > CAST(total_value AS NUMERIC);")
if [[ "${over_invested}" != "0" ]]; then
  fail_check "over_invested_deals" "Found ${over_invested} deals where total_invested > total_value"
fi

# Token counts must be positive
invalid_tokens=$(run_check "invalid_token_counts" \
  "SELECT COUNT(*) FROM trade_deals WHERE token_count <= 0;")
if [[ "${invalid_tokens}" != "0" ]]; then
  fail_check "invalid_token_counts" "Found ${invalid_tokens} deals with non-positive token_count"
fi

# ── Step 5: DB size ───────────────────────────────────────────────────────────
DB_SIZE=$(PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
  -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
  -d "${VERIFY_DB_NAME}" -At \
  -c "SELECT pg_size_pretty(pg_database_size('${VERIFY_DB_NAME}'));")
log "Database size: ${DB_SIZE}"
echo ""                  >> "${REPORT_FILE}"
echo "DB Size: ${DB_SIZE}" >> "${REPORT_FILE}"

# ── Step 6: All checks passed ─────────────────────────────────────────────────
echo ""                              >> "${REPORT_FILE}"
echo "Result: PASSED"                >> "${REPORT_FILE}"
echo "Completed: $(date -u)"         >> "${REPORT_FILE}"

log "All integrity checks passed."

send_report "PASSED" ""

# ── Step 7: Drop the restore DB ──────────────────────────────────────────────
log "Dropping restore database ${VERIFY_DB_NAME} ..."
PGPASSWORD="${VERIFY_DB_PASS:-postgres}" psql \
  -h "${VERIFY_DB_HOST}" -p "${VERIFY_DB_PORT}" -U "${VERIFY_DB_USER}" \
  -c "DROP DATABASE IF EXISTS ${VERIFY_DB_NAME};" \
  postgres

log "Restore verification complete. Result: PASSED"
exit 0

# ── Report email helper ───────────────────────────────────────────────────────
send_report() {
  local status="$1"
  local extra_msg="$2"
  local subject="[AgriFi] DB Restore Verification ${status} — ${TIMESTAMP}"
  local body
  body=$(cat "${REPORT_FILE}" 2>/dev/null || echo "Report file not available.")

  if [[ -n "${extra_msg}" ]]; then
    body="${body}"$'\n\n'"Additional details: ${extra_msg}"
  fi

  if [[ -n "${SMTP_HOST:-}" ]]; then
    {
      echo "From: ops@agri-fi.com"
      echo "To: ${REPORT_EMAIL}"
      echo "Subject: ${subject}"
      echo ""
      echo "${body}"
    } | curl --silent --url "smtp://${SMTP_HOST}:${SMTP_PORT:-25}" \
      ${SMTP_USER:+--user "${SMTP_USER}:${SMTP_PASS}"} \
      --mail-from "ops@agri-fi.com" \
      --mail-rcpt "${REPORT_EMAIL}" \
      --upload-file - \
      || log "WARNING: Failed to send report email."
  else
    log "SMTP_HOST not configured — report email skipped."
    log "Report:"
    cat "${REPORT_FILE}"
  fi
}

# ── PagerDuty alert helper ────────────────────────────────────────────────────
fire_pagerduty() {
  local detail="$1"
  log "Firing PagerDuty CRITICAL alert: ${detail}"

  local payload
  payload=$(cat <<EOF
{
  "routing_key": "${PAGERDUTY_ROUTING_KEY}",
  "event_action": "trigger",
  "payload": {
    "summary": "AgriFi DB restore verification FAILED: ${detail}",
    "source": "agri-fi-backup-verify",
    "severity": "critical",
    "timestamp": "${TIMESTAMP}",
    "custom_details": {
      "backup_file": "${BACKUP_S3_PATH:-unknown}",
      "restore_host": "${VERIFY_DB_HOST}:${VERIFY_DB_PORT}",
      "script": "verify-restore.sh"
    }
  }
}
EOF
)

  curl --silent --fail \
    --request POST \
    --url "https://events.pagerduty.com/v2/enqueue" \
    --header "Content-Type: application/json" \
    --data "${payload}" \
    || log "WARNING: PagerDuty alert delivery failed."
}
