#!/bin/bash

# Database Backup Script for PostgreSQL to AWS S3
# This script performs a backup of the PostgreSQL database and uploads it to S3
# Usage: ./db-backup.sh

set -euo pipefail

# Configuration
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-postgres}"
DB_NAME="${DATABASE_NAME:-agric_onchain}"
S3_BUCKET="${BACKUP_S3_BUCKET:-agrifi-backups}"
S3_PREFIX="${BACKUP_S3_PREFIX:-database-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/db-backup.log}"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Logging function
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
  log "ERROR: $*"
  exit 1
}

# Verify required tools
check_requirements() {
  local required_tools=("pg_dump" "aws" "gzip")
  for tool in "${required_tools[@]}"; do
    if ! command -v "$tool" &> /dev/null; then
      error_exit "Required tool not found: $tool"
    fi
  done
  log "All required tools are available"
}

# Verify database connectivity
check_database_connection() {
  log "Checking database connectivity..."
  if ! PGPASSWORD="$DATABASE_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" &> /dev/null; then
    error_exit "Cannot connect to database at $DB_HOST:$DB_PORT"
  fi
  log "Database connection successful"
}

# Verify S3 bucket access
check_s3_access() {
  log "Checking S3 bucket access..."
  if ! aws s3 ls "s3://$S3_BUCKET" --region "${AWS_REGION:-us-east-1}" &> /dev/null; then
    error_exit "Cannot access S3 bucket: $S3_BUCKET"
  fi
  log "S3 bucket access verified"
}

# Create backup
create_backup() {
  local backup_timestamp=$(date +'%Y%m%d_%H%M%S')
  local backup_file="/tmp/agri-fi-backup_${backup_timestamp}.sql"
  local compressed_file="${backup_file}.gz"

  log "Starting database backup..."
  
  if ! PGPASSWORD="$DATABASE_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --verbose \
    --no-password \
    --format=plain \
    > "$backup_file" 2>> "$LOG_FILE"; then
    error_exit "pg_dump failed"
  fi

  log "Backup file created: $backup_file ($(du -h "$backup_file" | cut -f1))"

  # Compress the backup
  log "Compressing backup file..."
  if ! gzip -9 "$backup_file"; then
    error_exit "Failed to compress backup file"
  fi

  log "Compressed backup: $compressed_file ($(du -h "$compressed_file" | cut -f1))"

  echo "$compressed_file"
}

# Upload to S3
upload_to_s3() {
  local backup_file="$1"
  local backup_filename=$(basename "$backup_file")
  local s3_path="s3://$S3_BUCKET/$S3_PREFIX/$backup_filename"

  log "Uploading backup to S3: $s3_path"

  if ! aws s3 cp "$backup_file" "$s3_path" \
    --region "${AWS_REGION:-us-east-1}" \
    --sse AES256 \
    --storage-class STANDARD_IA; then
    error_exit "Failed to upload backup to S3"
  fi

  log "Backup successfully uploaded to S3"

  # Verify upload
  if ! aws s3 ls "$s3_path" --region "${AWS_REGION:-us-east-1}" &> /dev/null; then
    error_exit "Failed to verify S3 upload"
  fi

  log "S3 upload verified"

  echo "$s3_path"
}

# Cleanup old backups
cleanup_old_backups() {
  log "Cleaning up backups older than $BACKUP_RETENTION_DAYS days..."

  local cutoff_date=$(date -d "$BACKUP_RETENTION_DAYS days ago" +'%Y-%m-%d' 2>/dev/null || date -v-${BACKUP_RETENTION_DAYS}d +'%Y-%m-%d')

  # List and delete old backups
  local deleted_count=0
  while IFS= read -r backup_path; do
    if [ -n "$backup_path" ]; then
      log "Deleting old backup: $backup_path"
      aws s3 rm "$backup_path" --region "${AWS_REGION:-us-east-1}" || log "Warning: Failed to delete $backup_path"
      ((deleted_count++))
    fi
  done < <(aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" --region "${AWS_REGION:-us-east-1}" --recursive | \
    awk -v cutoff="$cutoff_date" '$1 < cutoff {print "s3://'$S3_BUCKET'/" $4}')

  if [ "$deleted_count" -gt 0 ]; then
    log "Deleted $deleted_count old backup(s)"
  else
    log "No old backups to delete"
  fi
}

# Cleanup local backup file
cleanup_local_backup() {
  local backup_file="$1"
  log "Cleaning up local backup file: $backup_file"
  rm -f "$backup_file"
}

# Send notification (optional)
send_notification() {
  local status="$1"
  local message="$2"

  if [ -n "${SNS_TOPIC_ARN:-}" ]; then
    log "Sending SNS notification..."
    aws sns publish \
      --topic-arn "$SNS_TOPIC_ARN" \
      --subject "Database Backup $status" \
      --message "$message" \
      --region "${AWS_REGION:-us-east-1}" || log "Warning: Failed to send SNS notification"
  fi
}

# Main execution
main() {
  log "=========================================="
  log "Database Backup Script Started"
  log "=========================================="
  log "Database: $DB_NAME"
  log "Host: $DB_HOST:$DB_PORT"
  log "S3 Bucket: $S3_BUCKET"
  log "S3 Prefix: $S3_PREFIX"

  check_requirements
  check_database_connection
  check_s3_access

  local backup_file
  backup_file=$(create_backup)

  local s3_path
  s3_path=$(upload_to_s3 "$backup_file")

  cleanup_old_backups
  cleanup_local_backup "$backup_file"

  log "=========================================="
  log "Database Backup Completed Successfully"
  log "Backup Location: $s3_path"
  log "=========================================="

  send_notification "SUCCESS" "Database backup completed successfully.\nLocation: $s3_path"
}

# Run main function
main "$@"
