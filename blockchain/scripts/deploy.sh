#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgriFi Soroban Contract Deployment Pipeline (Dockerized)
#
# This script automates the compilation, deployment, and integration of
# Soroban smart contracts using Docker containers to ensure consistency.
#
# Prerequisites:
#   - Docker installed and running
#   - DEPLOYER_SECRET env var set (Stellar secret key with XLM)
#   - USDC_CONTRACT_ID env var set (USDC token contract ID)
#
# Usage:
#   DEPLOYER_SECRET=S... USDC_CONTRACT_ID=C... ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
NETWORK="${NETWORK:-testnet}"
RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-200}"

DEPLOYER_SECRET="${DEPLOYER_SECRET:?DEPLOYER_SECRET environment variable is required}"
USDC_CONTRACT_ID="${USDC_CONTRACT_ID:?USDC_CONTRACT_ID environment variable is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLOCKCHAIN_DIR="$ROOT_DIR/blockchain"
BACKEND_ENV="$ROOT_DIR/backend/.env"

# Docker Images
RUST_IMAGE="rust:1.76-slim-bookworm"
STELLAR_CLI_IMAGE="stellar/stellar-cli:latest"

echo "🚀 Starting AgriFi Deployment Pipeline ($NETWORK)"

# ── 1. Compilation ────────────────────────────────────────────────────────────
echo "📦 Step 1: Compiling contracts inside Docker..."
docker run --rm \
  -v "$BLOCKCHAIN_DIR":/workspace \
  -w /workspace \
  "$RUST_IMAGE" \
  bash -c "apt-get update && apt-get install -y clang && \
           rustup target add wasm32-unknown-unknown && \
           cargo build --target wasm32-unknown-unknown --release"

WASM_DIR="$BLOCKCHAIN_DIR/target/wasm32-unknown-unknown/release"

# ── Helper: Docker Stellar CLI ───────────────────────────────────────────────
stellar_run() {
  docker run --rm \
    -v "$BLOCKCHAIN_DIR":/workspace \
    -w /workspace \
    -e STELLAR_NETWORK="$NETWORK" \
    -e STELLAR_RPC_URL="$RPC_URL" \
    -e STELLAR_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE" \
    "$STELLAR_CLI_IMAGE" "$@"
}

# ── Helper: Deploy + Capture ID ──────────────────────────────────────────────
deploy_wasm() {
  local name="$1"
  local wasm_path="target/wasm32-unknown-unknown/release/$2"
  echo "  🚀 Deploying $name..."
  
  # Deploy contract and capture the ID (Stellar IDs start with 'C' and are 56 chars)
  local output
  output=$(stellar_run contract deploy \
    --wasm "$wasm_path" \
    --source "$DEPLOYER_SECRET" \
    --network "$NETWORK" 2>&1)
  
  local contract_id
  contract_id=$(echo "$output" | grep -oE "C[A-Z0-9]{55}" | head -n 1)
  
  if [ -z "$contract_id" ]; then
    echo "❌ Failed to deploy $name. Output:"
    echo "$output"
    exit 1
  fi
  
  echo "$contract_id"
}

# ── 2. Deployment ─────────────────────────────────────────────────────────────
echo "🌐 Step 2: Uploading WASM and instantiating contracts..."

ADMIN_ADDRESS=$(stellar_run keys address "$DEPLOYER_SECRET")

# ProjectFactory
FACTORY_ID=$(deploy_wasm "ProjectFactory" "project_factory.wasm")
echo "     ✅ ProjectFactory: $FACTORY_ID"

echo "     Initialize ProjectFactory..."
stellar_run contract invoke \
  --id "$FACTORY_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDRESS"

# MarketplaceSettlement
SETTLEMENT_ID=$(deploy_wasm "MarketplaceSettlement" "marketplace_settlement.wasm")
echo "     ✅ MarketplaceSettlement: $SETTLEMENT_ID"

echo "     Initialize MarketplaceSettlement..."
stellar_run contract invoke \
  --id "$SETTLEMENT_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --usdc_token "$USDC_CONTRACT_ID" \
  --platform_fee_bps "$PLATFORM_FEE_BPS"

# RevenueDistributor
DISTRIBUTOR_ID=$(deploy_wasm "RevenueDistributor" "revenue_distributor.wasm")
echo "     ✅ RevenueDistributor: $DISTRIBUTOR_ID"

echo "     Initialize RevenueDistributor..."
stellar_run contract invoke \
  --id "$DISTRIBUTOR_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --usdc_token "$USDC_CONTRACT_ID"

# ── 3. Integration ────────────────────────────────────────────────────────────
echo "💾 Step 3: Updating backend configuration..."

update_env() {
  local key="$1"
  local value="$2"
  if grep -q "^$key=" "$BACKEND_ENV" 2>/dev/null; then
    sed -i "s|^$key=.*|$key=$value|" "$BACKEND_ENV"
  else
    echo "$key=$value" >> "$BACKEND_ENV"
  fi
}

# Create .env if it doesn't exist
touch "$BACKEND_ENV"

update_env "SOROBAN_RPC_URL" "$RPC_URL"
update_env "SOROBAN_FACTORY_CONTRACT_ID" "$FACTORY_ID"
update_env "SOROBAN_SETTLEMENT_CONTRACT_ID" "$SETTLEMENT_ID"
update_env "SOROBAN_DISTRIBUTOR_CONTRACT_ID" "$DISTRIBUTOR_ID"
update_env "USDC_CONTRACT_ID" "$USDC_CONTRACT_ID"

echo ""
echo "🎉 Deployment Successful!"
echo "----------------------------------------"
echo "ProjectFactory:       $FACTORY_ID"
echo "MarketplaceSettlement: $SETTLEMENT_ID"
echo "RevenueDistributor:    $DISTRIBUTOR_ID"
echo "----------------------------------------"
echo "Backend config updated: $BACKEND_ENV"
