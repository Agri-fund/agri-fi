#!/bin/bash
set -euo pipefail
SHA=5a8e212272380dc45ced69f5105792505d521151
OWNER=re; OWNER=rilwanubala
REPO=agri-fi
for i in $(seq 1 30); do
  echo "poll $i/30"
  count=$(gh api "repos/${OWNER}/${REPO}/actions/runs?per_page=50&head_sha=${SHA}" --jq '.workflow_runs | length' 2>/dev/null || true)
  if [[ "$count" =~ ^[0-9]+$ ]] && [ "$count" -gt 0 ]; then
    echo "Found $count workflow run(s) for $SHA"
    gh api "repos/${OWNER}/${REPO}/actions/runs?per_page=50&head_sha=${SHA}" --jq '.workflow_runs[] | {id,status,conclusion,html_url,name,run_number,head_branch,created_at}'
    run_id=$(gh api "repos/${OWNER}/${REPO}/actions/runs?per_page=50&head_sha=${SHA}" --jq '.workflow_runs[0].id')
    echo -e "\nFetching jobs for run_id: $run_id"
    gh api "repos/${OWNER}/${REPO}/actions/runs/${run_id}/jobs" --jq '.jobs[] | {id,name,status,conclusion,html_url,logs_url}'
    exit 0
  fi
  sleep 10
done

echo "No workflow runs found for commit ${SHA} after polling."
