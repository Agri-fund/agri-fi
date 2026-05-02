# AgriFi Soroban Smart Contracts

Stellar-native smart contracts powering the AgriFi platform's investment escrow, revenue distribution, and marketplace settlement.

## Contracts

| Contract | Description |
|---|---|
| `FarmCampaign` | Per-project escrow, investment tracking, milestone releases, revenue distribution |
| `ProjectFactory` | On-chain registry of all deployed campaign contracts |
| `RevenueDistributor` | Standalone proportional USDC payout distributor |
| `MarketplaceSettlement` | Buyer → escrow → farmer + investors settlement |

## Prerequisites

```bash
# Rust + wasm32 target
rustup default stable
rustup target add wasm32-unknown-unknown

# Stellar CLI
cargo install --locked stellar-cli --features opt
```

## Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

WASM files output to `target/wasm32-unknown-unknown/release/`.

## Deploy

```bash
# Set environment variables
export DEPLOYER_SECRET=S...          # Stellar secret key with XLM
export USDC_CONTRACT_ID=C...         # USDC SAC contract on target network
export NETWORK=testnet               # or mainnet

./scripts/deploy.sh
```

The script outputs contract IDs — add them to `backend/.env`:

```env
SOROBAN_FACTORY_CONTRACT_ID=C...
SOROBAN_SETTLEMENT_CONTRACT_ID=C...
SOROBAN_DISTRIBUTOR_CONTRACT_ID=C...
USDC_CONTRACT_ID=C...
```

## FarmCampaign Lifecycle

```
initialize() → invest() × N → approve() → release_milestone() × 4 → distribute_revenue()
                                                                  ↓
                                                            (if failed) → refund()
```

### Key operations

| Method | Caller | Description |
|---|---|---|
| `initialize` | Platform (once) | Set farmer, target, deadline, milestones |
| `invest` | Investor | Lock USDC in contract |
| `approve` | Admin | Verify KYC + activate campaign |
| `release_milestone` | Admin | Pay farmer 1/4 tranche |
| `distribute_revenue` | Admin | Split harvest revenue to investors |
| `refund` | Investor | Claim back if deadline passed or failed |
| `pause` / `unpause` | Admin | Emergency controls |
| `mark_failed` | Admin | Enable investor refunds |

## MarketplaceSettlement Lifecycle

```
create_order() [buyer locks USDC] → confirm_delivery() [auto-split payout]
                                  ↓
                            (dispute) → refund_buyer()
```

## Revenue Split

- **Farmer**: configurable per campaign (default ~98% of raised funds via milestones)
- **Investors**: proportional to USDC invested, paid from harvest revenue
- **Platform**: `platform_fee_bps` (default 200 = 2%)

## Security

- All admin functions require `admin.require_auth()` — Stellar signature verification
- Investor functions require `investor.require_auth()`
- Reentrancy: Soroban's execution model prevents reentrancy by design
- Emergency pause on all campaigns via `pause()` / `mark_failed()`
- Funds only leave the contract via explicit transfer operations

## Testnet USDC

For testnet, use the Circle USDC testnet SAC contract:
```
USDC_CONTRACT_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```
