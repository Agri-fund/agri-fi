#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgriFi Soroban Contract Deploy Script
#
# Prerequisites:
#   - stellar CLI installed: https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli
#   - DEPLOYER_SECRET env var set (Stellar secret key with XLM for fees)
#   - USDC_CONTRACT_ID env var set (USDC token contract on target network)
#   - NETWORK: testnet (default) or mainnet
#
# Usage:
#   DEPLOYER_SECRET=S... USDC_CONTRACT_ID=C... ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
DEPLOYER_SECRET="${DEPLOYER_SECRET:?DEPLOYER_SECRET is required}"
USDC_CONTRACT_ID="${USDC_CONTRACT_ID:?USDC_CONTRACT_ID is required}"
PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-200}"  # 2%

echo "🚀 Deploying AgriFi Soroban contracts to $NETWORK..."

# ── Build WASM ────────────────────────────────────────────────────────────────
echo "📦 Building contracts..."
cargo build --manifest-path "$(dirname "$0")/../Cargo.toml" \
  --target wasm32-unknown-unknown --release

WASM_DIR="$(dirname "$0")/../target/wasm32-unknown-unknown/release"

# ── Helper: deploy + initialize ───────────────────────────────────────────────
deploy_contract() {
  local name="$1"
  local wasm="$2"
  echo "  Deploying $name..."
  stellar contract deploy \
    --wasm "$wasm" \
    --source "$DEPLOYER_SECRET" \
    --network "$NETWORK"
}

# ── Deploy ProjectFactory ─────────────────────────────────────────────────────
FACTORY_ID=$(deploy_contract "ProjectFactory" "$WASM_DIR/project_factory.wasm")
echo "  ProjectFactory: $FACTORY_ID"

stellar contract invoke \
  --id "$FACTORY_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$(stellar keys address "$DEPLOYER_SECRET" 2>/dev/null || echo "$DEPLOYER_SECRET")"

# ── Deploy MarketplaceSettlement ──────────────────────────────────────────────
SETTLEMENT_ID=$(deploy_contract "MarketplaceSettlement" "$WASM_DIR/marketplace_settlement.wasm")
echo "  MarketplaceSettlement: $SETTLEMENT_ID"

stellar contract invoke \
  --id "$SETTLEMENT_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$(stellar keys address "$DEPLOYER_SECRET" 2>/dev/null || echo "$DEPLOYER_SECRET")" \
  --usdc_token "$USDC_CONTRACT_ID" \
  --platform_fee_bps "$PLATFORM_FEE_BPS"

# ── Deploy RevenueDistributor ─────────────────────────────────────────────────
DISTRIBUTOR_ID=$(deploy_contract "RevenueDistributor" "$WASM_DIR/revenue_distributor.wasm")
echo "  RevenueDistributor: $DISTRIBUTOR_ID"

stellar contract invoke \
  --id "$DISTRIBUTOR_ID" \
  --source "$DEPLOYER_SECRET" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$(stellar keys address "$DEPLOYER_SECRET" 2>/dev/null || echo "$DEPLOYER_SECRET")" \
  --usdc_token "$USDC_CONTRACT_ID"

# ── Output ────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Deployment complete. Add these to your backend .env:"
echo ""
echo "SOROBAN_FACTORY_CONTRACT_ID=$FACTORY_ID"
echo "SOROBAN_SETTLEMENT_CONTRACT_ID=$SETTLEMENT_ID"
echo "SOROBAN_DISTRIBUTOR_CONTRACT_ID=$DISTRIBUTOR_ID"
echo ""
echo "Note: FarmCampaign contracts are deployed per-deal by the backend."
echo "      Use SorobanService.initializeCampaign() after each deployment."
