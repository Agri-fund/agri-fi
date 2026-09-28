#!/usr/bin/env bash
set -euo pipefail

echo "==> Verifying production seed safety..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"

# 1. Check backend package.json start:prod
if grep -q "seed" "${BACKEND_DIR}/package.json" | grep "start:prod"; then
  echo "❌ ERROR: 'start:prod' script in backend/package.json references seed commands!"
  exit 1
fi

# 2. Check backend Dockerfile CMD / ENTRYPOINT
if grep -iE "(CMD|ENTRYPOINT).*seed" "${BACKEND_DIR}/Dockerfile"; then
  echo "❌ ERROR: Dockerfile CMD or ENTRYPOINT references seed commands!"
  exit 1
fi

# 3. Check devops/k8s and docker-compose production services
if grep -rli --include="*.yaml" --include="*.yml" "seed\.ts" "${REPO_ROOT}/devops/k8s/" 2>/dev/null; then
  echo "❌ ERROR: Kubernetes production manifests reference seed.ts!"
  exit 1
fi


echo "✅ Production entrypoints are clean of database seeding scripts."
