#!/bin/bash

# Elasticsearch ILM and S3 Repository Setup
# 
# This script configures:
# 1. S3 repository for snapshot backups
# 2. ILM policy for log retention (90d hot → frozen → delete at 180d)
# 3. Index template with ILM rollover alias
#
# Prerequisites:
# - Elasticsearch running on localhost:9200
# - AWS credentials configured (for S3 bucket access)
# - S3 bucket 'agri-fi-elasticsearch-backups' created
#
# Usage:
#   ./elasticsearch-setup.sh
#
# Or with custom Elasticsearch URL:
#   ES_URL=https://elasticsearch:9200 ./elasticsearch-setup.sh

set -e

ES_URL="${ES_URL:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASSWORD="${ES_PASSWORD:-}"

# Build auth header if password provided
if [ -n "$ES_PASSWORD" ]; then
  AUTH="-u $ES_USER:$ES_PASSWORD"
else
  AUTH=""
fi

echo "Elasticsearch Setup Script"
echo "==========================="
echo "Target: $ES_URL"
echo ""

# 1. Check Elasticsearch connectivity
echo "✓ Checking Elasticsearch connectivity..."
if ! curl -s $AUTH "$ES_URL/_cluster/health" > /dev/null; then
  echo "❌ Cannot connect to Elasticsearch at $ES_URL"
  exit 1
fi
echo "  Connected successfully"
echo ""

# 2. Create S3 repository
echo "✓ Creating S3 snapshot repository 's3-backup-repo'..."
curl -s -X PUT $AUTH "$ES_URL/_snapshot/s3-backup-repo" \
  -H "Content-Type: application/json" \
  -d @s3-repository.json | jq .
echo ""

# 3. Create ILM policy
echo "✓ Creating ILM policy 'agri-fi-logs-retention'..."
curl -s -X PUT $AUTH "$ES_URL/_ilm/policy/agri-fi-logs-retention" \
  -H "Content-Type: application/json" \
  -d @ilm-policy.json | jq .
echo ""

# 4. Create/update index template
echo "✓ Creating index template for 'agri-fi-*' pattern..."
curl -s -X PUT $AUTH "$ES_URL/_index_template/agri-fi-logs-template" \
  -H "Content-Type: application/json" \
  -d @index-template.json | jq .
echo ""

# 5. Apply ILM policy to existing indices (optional, for indices created before template)
echo "✓ Applying ILM policy to existing indices matching 'agri-fi-*'..."
curl -s -X PUT $AUTH "$ES_URL/agri-fi-*/_settings" \
  -H "Content-Type: application/json" \
  -d '{
    "index.lifecycle.name": "agri-fi-logs-retention",
    "index.lifecycle.rollover_alias": "agri-fi-logs"
  }' | jq .
echo ""

# 6. Verify setup
echo "✓ Verifying ILM policy..."
curl -s -X GET $AUTH "$ES_URL/_ilm/policy/agri-fi-logs-retention" | jq .
echo ""

echo "✓ Verifying S3 repository..."
curl -s -X GET $AUTH "$ES_URL/_snapshot/s3-backup-repo" | jq .
echo ""

echo "✓ Verifying index template..."
curl -s -X GET $AUTH "$ES_URL/_index_template/agri-fi-logs-template" | jq .
echo ""

echo "✅ Elasticsearch setup complete!"
echo ""
echo "Next steps:"
echo "  1. Verify indices are managed by ILM: curl http://localhost:9200/agri-fi-*/_ilm/explain"
echo "  2. Monitor ILM progress: curl http://localhost:9200/_ilm/status"
echo "  3. View snapshots: curl http://localhost:9200/_snapshot/s3-backup-repo/_all"
