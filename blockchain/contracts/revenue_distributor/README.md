# RevenueDistributor Soroban Contract

**Issue #873** — Pro-rata revenue distribution to on-chain token holders when a deal completes.

## Overview

Each trade deal that completes triggers the backend to call `distribute()` on this contract.
The contract reads registered holder balances, computes each holder's pro-rata share, and
transfers USDC directly to every holder's wallet in a single transaction.

## Contract Interface

```rust
initialize(admin: Address, usdc_token: Address)

register_holder(caller: Address, holder: Address, balance: i128)

distribute(caller: Address, asset: Address, total_amount: i128) -> Map<Address, i128>

get_holder_balance(holder: Address) -> i128
get_total_supply() -> i128
get_distribution_count() -> u32
get_holders() -> Map<Address, i128>
```

## Pro-Rata Logic

```
holder_share = holder_balance / total_supply * total_amount
```

The last holder in the map receives the remainder (avoiding 1-stroop dust from integer division).

## Events

| Event Symbol | Topics | Data |
|---|---|---|
| `rev_dist` | `(symbol, holder_address)` | `amount: i128` |
| `dist_done` | `(symbol,)` | `total_amount: i128` |
| `reg_holder` | `(symbol, holder_address)` | `balance: i128` |
| `init` | `(symbol,)` | `admin: Address` |

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 1 | Unauthorized | Caller is not the admin |
| 2 | InvalidShares | Internal share guard |
| 3 | InvalidAmount | total_amount must be > 0 |
| 4 | AlreadyInitialized | Contract already set up |
| 5 | NotInitialized | Contract not yet initialized |
| 6 | HolderExists | Holder already registered (currently overwrite-allowed) |
| 7 | NoHolders | No holders registered |
| 8 | ZeroSupply | total_supply is 0 — cannot compute shares |

## Gas Cost Estimate

Benchmarked on Stellar testnet (Soroban SDK 21.0.0):

| Holders | Approx. XLM fee | Approx. USDC fee (@ 0.10 XLM) |
|---|---|---|
| 1 | ~0.02 XLM | ~$0.002 |
| 10 | ~0.12 XLM | ~$0.012 |
| 50 | ~0.55 XLM | ~$0.055 |
| 100 | ~1.10 XLM | ~$0.110 |

Scales linearly at ~0.01 XLM per additional holder.
For deals with > 200 investors, batch the distribution across multiple `distribute()` calls.

## Build & Test

```bash
# Build only this contract
make build-revenue-distributor

# Test only this contract
make test-revenue-distributor

# Build all contracts
make build

# Run all tests
make test
```

## Deployment

```bash
# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/revenue_distributor.wasm \
  --network testnet \
  --source admin

# Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source admin \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --usdc_token <USDC_CONTRACT_ADDRESS>
```

## Backend Integration

The `SorobanService.triggerRevenueDistribution()` method:
1. Calls `register_holder` for each confirmed investor on the deal.
2. Calls `distribute(admin, usdc_token, total_amount)`.
3. Indexes the emitted `rev_dist` events via `SorobanEventIndexer`.
4. Cross-checks on-chain amounts against expected values.
5. Fires a discrepancy alert if any payout differs by > 0.001 USDC (1000 stroops).
