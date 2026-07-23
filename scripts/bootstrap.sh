#!/usr/bin/env bash
set -euo pipefail

REQUIRED_NODE_MAJOR="${REQUIRED_NODE_MAJOR:-20}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command '$1'" >&2
    exit 1
  fi
}

echo "Checking prerequisites..."
require_cmd node
require_cmd npm
require_cmd docker

NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"

if [[ "$NODE_MAJOR" != "$REQUIRED_NODE_MAJOR" ]]; then
  echo "Error: Node.js major version must be ${REQUIRED_NODE_MAJOR}.x (found v${NODE_VERSION})." >&2
  exit 1
fi

echo "Node.js version OK: v${NODE_VERSION}"

echo "Installing backend dependencies..."
pushd backend >/dev/null
npm ci
popd >/dev/null

echo "Installing frontend dependencies..."
pushd frontend >/dev/null
npm ci
popd >/dev/null

echo "Starting infrastructure with docker compose..."
docker compose up -d postgres rabbitmq

echo "Running backend migrations..."
pushd backend >/dev/null
npm run migration:run
popd >/dev/null

echo "Bootstrap complete."
