#!/usr/bin/env bash
# backup.sh — pg_dump → AES-256 encrypt → S3 upload
# Required env vars:
#   DATABASE_URL          postgres connection string
#   BACKUP_ENCRYPTION_KEY AES-256 passphrase (or fetched from AWS Secrets Manager)
#   BACKUP_S3_BUCKET      destination S3 bucket name
#   BACKUP_S3_PREFIX      (optional) key prefix, defaults to "backups"
#   AWS_SECRET_ID         (optional) AWS Secrets Manager secret id for the encryption key

set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DUMP_FILE="/tmp/agri-fi-${TIMESTAMP}.pgdump"
ENCRYPTED_FILE="${DUMP_FILE}.enc"
S3_PREFIX="${BACKUP_S3_PREFIX:-backups}"
S3_KEY="${S3_PREFIX}/agri-fi-${TIMESTAMP}.pgdump.enc"

# ── Fetch encryption key ─────────────────────────────────────────────────────
if [[ -n "${AWS_SECRET_ID:-}" ]]; then
  BACKUP_ENCRYPTION_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "${AWS_SECRET_ID}" \
    --query SecretString \
    --output text)
fi

if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY is not set." >&2
  exit 1
fi

if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "ERROR: BACKUP_S3_BUCKET is not set." >&2
  exit 1
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
echo "Running pg_dump..."
pg_dump "${DATABASE_URL}" --format=custom --no-password --file="${DUMP_FILE}"

# ── Encrypt (AES-256-CBC via openssl) ────────────────────────────────────────
echo "Encrypting backup..."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in "${DUMP_FILE}" \
  -out "${ENCRYPTED_FILE}"

# ── Upload to S3 ─────────────────────────────────────────────────────────────
echo "Uploading to s3://${BACKUP_S3_BUCKET}/${S3_KEY} ..."
aws s3 cp "${ENCRYPTED_FILE}" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
  --storage-class STANDARD_IA

# ── Cleanup ──────────────────────────────────────────────────────────────────
rm -f "${DUMP_FILE}" "${ENCRYPTED_FILE}"

echo "Backup complete: s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
