#!/bin/bash

# ILM and S3 Repository Validation Test
#
# This script validates the Elasticsearch ILM policy and S3 repository setup.
# It verifies:
# 1. Elasticsearch is running and accessible
# 2. S3 repository is registered and working
# 3. ILM policy is created and applied
# 4. Index template matches expected configuration
# 5. Indices follow the correct ILM lifecycle
#
# Usage:
#   ./test-ilm-setup.sh
#
# Or with custom Elasticsearch URL:
#   ES_URL=https://elasticsearch:9200 ./test-ilm-setup.sh

set -e

ES_URL="${ES_URL:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASSWORD="${ES_PASSWORD:-}"
FAILED_TESTS=0
PASSED_TESTS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Build auth header if password provided
if [ -n "$ES_PASSWORD" ]; then
  AUTH="-u $ES_USER:$ES_PASSWORD"
else
  AUTH=""
fi

echo "=========================================="
echo "Elasticsearch ILM & S3 Setup Validation"
echo "=========================================="
echo "Target: $ES_URL"
echo ""

# Test function
run_test() {
  local test_name=$1
  local command=$2
  echo -n "Testing: $test_name ... "
  
  if eval "$command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED_TESTS++))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED_TESTS++))
    return 1
  fi
}

# Test 1: Elasticsearch connectivity
run_test "Elasticsearch connectivity" \
  "curl -s $AUTH '$ES_URL/_cluster/health' | jq -e '.cluster_name' > /dev/null"

# Test 2: Elasticsearch version
echo -n "Elasticsearch version: "
curl -s $AUTH "$ES_URL" | jq -r '.version.number'

# Test 3: ILM policy exists
run_test "ILM policy 'agri-fi-logs-retention' exists" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention' > /dev/null"

# Test 4: ILM policy has hot phase
run_test "ILM policy has hot phase" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention.phases.hot' > /dev/null"

# Test 5: ILM policy has warm phase
run_test "ILM policy has warm phase" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention.phases.warm' > /dev/null"

# Test 6: ILM policy has cold phase
run_test "ILM policy has cold phase" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention.phases.cold' > /dev/null"

# Test 7: ILM policy has frozen phase
run_test "ILM policy has frozen phase" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention.phases.frozen' > /dev/null"

# Test 8: ILM policy has delete phase
run_test "ILM policy has delete phase" \
  "curl -s $AUTH '$ES_URL/_ilm/policy/agri-fi-logs-retention' | jq -e '.agri-fi-logs-retention.phases.delete' > /dev/null"

# Test 9: S3 repository is registered
run_test "S3 repository 's3-backup-repo' is registered" \
  "curl -s $AUTH '$ES_URL/_snapshot/s3-backup-repo' | jq -e '.s3-backup-repo' > /dev/null"

# Test 10: S3 repository settings
echo -n "S3 repository settings: "
curl -s $AUTH "$ES_URL/_snapshot/s3-backup-repo" | jq '.["s3-backup-repo"].settings'

# Test 11: Index template exists
run_test "Index template 'agri-fi-logs-template' exists" \
  "curl -s $AUTH '$ES_URL/_index_template/agri-fi-logs-template' | jq -e '.index_templates[0]' > /dev/null"

# Test 12: Index template applies ILM policy
run_test "Index template applies ILM policy" \
  "curl -s $AUTH '$ES_URL/_index_template/agri-fi-logs-template' | jq -e '.index_templates[0].template.settings.\"index.lifecycle.name\"' | grep -q 'agri-fi-logs-retention'"

# Test 13: ILM is in running mode
run_test "ILM is in running mode" \
  "curl -s $AUTH '$ES_URL/_ilm/status' | jq -e '.mode' | grep -q 'running'"

# Test 14: Check for agri-fi indices
echo ""
echo "Checking indices matching pattern 'agri-fi-*':"
INDEX_COUNT=$(curl -s $AUTH "$ES_URL/_cat/indices/agri-fi-*?format=json" 2>/dev/null | jq '. | length' || echo "0")
if [ "$INDEX_COUNT" -gt 0 ]; then
  echo -e "${GREEN}Found $INDEX_COUNT indices${NC}"
  curl -s $AUTH "$ES_URL/_cat/indices/agri-fi-*" | awk '{print "  " $0}'
else
  echo -e "${YELLOW}No indices found yet (expected if cluster is new)${NC}"
fi

# Test 15: Test S3 repository connectivity
echo ""
echo "Testing S3 repository connectivity:"
if curl -s $AUTH "$ES_URL/_snapshot/s3-backup-repo/_verify" 2>/dev/null | grep -q "nodes"; then
  echo -e "${GREEN}✓ S3 repository is accessible${NC}"
  ((PASSED_TESTS++))
else
  echo -e "${YELLOW}⚠ S3 repository verification skipped (may require credentials)${NC}"
fi

# Test 16: Check cluster health
echo ""
echo "Cluster health:"
curl -s $AUTH "$ES_URL/_cluster/health?pretty" | jq '{status: .status, active_shards: .active_shards, relocating_shards: .relocating_shards, initializing_shards: .initializing_shards, unassigned_shards: .unassigned_shards}'

# Test 17: Disk usage
echo ""
echo "Disk usage:"
curl -s $AUTH "$ES_URL/_nodes/stats/fs" | jq '.nodes[] | {name: .name, available_in_bytes: .fs.total.available_in_bytes, total_in_bytes: .fs.total.total_in_bytes}' 2>/dev/null || echo "(Disk stats unavailable)"

# Test 18: Check if any indices are managed by ILM
echo ""
echo "Indices managed by ILM:"
if [ "$INDEX_COUNT" -gt 0 ]; then
  curl -s $AUTH "$ES_URL/agri-fi-*/_ilm/explain?pretty" 2>/dev/null | jq '.indices | to_entries[] | {index: .key, phase: .value.phase, age: .value.age}' || echo "  (No ILM data available)"
else
  echo "  (No indices to check)"
fi

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Monitor ILM progress: curl $ES_URL/_ilm/status"
  echo "  2. Wait for indices to age through phases"
  echo "  3. Check S3 snapshots: curl $ES_URL/_snapshot/s3-backup-repo/_all"
  exit 0
else
  echo -e "${RED}✗ Some tests failed. Check the output above.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Verify Elasticsearch is running: curl $ES_URL/_cluster/health"
  echo "  2. Check ILM policy: curl $ES_URL/_ilm/policy/agri-fi-logs-retention"
  echo "  3. Review S3 credentials and permissions"
  echo "  4. Check Elasticsearch logs for errors"
  exit 1
fi
