#!/usr/bin/env bash
# Manual secret rotation runbook for RDS credentials and KMS key material (#852).
#
# Run this script when:
#   - Automatic rotation has failed (CloudWatch alarm triggered)
#   - A credential compromise is suspected
#   - Pre-planned manual rotation window
#
# Prerequisites:
#   - AWS CLI configured with credentials that have SecretsManager:RotateSecret
#     and kms:DescribeKey permissions
#   - jq installed
#   - DB_SECRET_ARN environment variable set, or passed as first argument

set -euo pipefail

SECRET_ARN="${1:-${DB_SECRET_ARN:-}}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ -z "$SECRET_ARN" ]]; then
  echo "Usage: $0 <secret-arn>" >&2
  echo "Or set DB_SECRET_ARN environment variable." >&2
  exit 1
fi

echo "=== Agri-Fi Secret Rotation Runbook ==="
echo "Secret ARN : $SECRET_ARN"
echo "Region     : $AWS_REGION"
echo "Started at : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Verify the secret exists and rotation is configured
echo "Step 1: Verifying secret configuration..."
aws secretsmanager describe-secret \
  --secret-id "$SECRET_ARN" \
  --region "$AWS_REGION" \
  --query '{Name:Name,RotationEnabled:RotationEnabled,LastRotatedDate:LastRotatedDate}' \
  --output table

# 2. Trigger immediate rotation
echo ""
echo "Step 2: Triggering immediate rotation..."
ROTATION_RESPONSE=$(aws secretsmanager rotate-secret \
  --secret-id "$SECRET_ARN" \
  --region "$AWS_REGION" \
  --output json)

echo "$ROTATION_RESPONSE" | jq '{VersionId: .VersionId, Name: .Name}'

# 3. Poll until rotation completes (max 5 minutes)
echo ""
echo "Step 3: Waiting for rotation to complete..."
MAX_WAIT=300
ELAPSED=0
INTERVAL=10

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  STATUS=$(aws secretsmanager describe-secret \
    --secret-id "$SECRET_ARN" \
    --region "$AWS_REGION" \
    --query 'RotationStatus' \
    --output text 2>/dev/null || echo "UNKNOWN")

  echo "  Rotation status: $STATUS (${ELAPSED}s elapsed)"

  if [[ "$STATUS" == "rotating" ]]; then
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
  else
    break
  fi
done

# 4. Verify new secret value is readable
echo ""
echo "Step 4: Verifying new credentials are readable..."
aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --region "$AWS_REGION" \
  --query '{CreatedDate:CreatedDate,VersionId:VersionId}' \
  --output table

echo ""
echo "Step 5: Post-rotation checklist"
echo "  [ ] Verify application health endpoint returns 200 (no DB connection errors)"
echo "  [ ] Check CloudWatch logs for TypeORM reconnect events"
echo "  [ ] Confirm Secrets Manager CloudWatch alarm is in OK state"
echo "  [ ] Update .env.staging / CI secrets if manual override was in place"
echo ""
echo "Rotation completed at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "======================================="
