#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
AUTH_PATH="${AUTH_PATH:-/v1/auth/login}"
PUBLIC_PATH="${PUBLIC_PATH:-/v1/health}"
REQUESTS="${REQUESTS:-20}"

request_codes() {
  local path="$1"
  for _ in $(seq 1 "${REQUESTS}"); do
    curl --silent --output /dev/null --write-out '%{http_code}\n' "${BASE_URL}${path}"
  done
}

auth_429_count=$(request_codes "${AUTH_PATH}" | awk '$1 == 429 { count++ } END { print count + 0 }')
public_429_count=$(request_codes "${PUBLIC_PATH}" | awk '$1 == 429 { count++ } END { print count + 0 }')

if [[ "${auth_429_count}" -eq 0 ]]; then
  echo "Expected auth requests to be rate limited with HTTP 429" >&2
  exit 1
fi

if [[ "${public_429_count}" -eq 0 ]]; then
  echo "Expected public requests to be rate limited with HTTP 429" >&2
  exit 1
fi

echo "Rate-limit smoke test passed: auth=${auth_429_count} public=${public_429_count} HTTP 429 responses"
