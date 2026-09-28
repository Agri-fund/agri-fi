# Blockchain Developer Guide: Extending Soroban Contracts & Redeployment

This guide provides comprehensive documentation for developing, extending, testing, deploying, and upgrading Soroban smart contracts on the Stellar network for Agri-Fi. It also covers event emission patterns and integration with the backend event listener and indexer services.

---

## Table of Contents

1. [Workspace Layout & Architecture](#workspace-layout--architecture)
2. [Smart Contract Implementation Architecture](#smart-contract-implementation-architecture)
   - [Storage Models & State Management](#storage-models--state-management)
   - [Authorization & Multi-Role Guards](#authorization--multi-role-guards)
   - [Cross-Contract Invocations & Token Interactions](#cross-contract-invocations--token-interactions)
   - [Error Handling & Revert Mechanics](#error-handling--revert-mechanics)
   - [Storage Rent, Footprints, & Fee Considerations](#storage-rent-footprints--fee-considerations)
3. [Testing Harness & Simulation](#testing-harness--simulation)
4. [Compilation & Deployment Workflow](#compilation--deployment-workflow)
5. [Upgrades & Multi-Sig Governance](#upgrades--multi-sig-governance)
6. [Backend Integration (Listener & Indexer)](#backend-integration-listener--indexer)
7. [Developer Checklist](#developer-checklist)

---

## 1. Workspace Layout & Architecture

Agri-Fi contracts are organized as a Cargo workspace rooted in the `blockchain/` directory.

```
blockchain/
├── Cargo.toml                    # Workspace configuration & dependency pinning
├── Cargo.lock                    # Dependency lockfile
├── Makefile                      # Standardized build, test, and container recipes
├── .cargo/
│   └── config.toml               # Target wasm32-unknown-unknown defaults
├── contracts/
│   ├── escrow/                   # Escrow settlement, milestone releases & refunds
│   ├── farm_campaign/            # Campaign lifecycle, funding caps & deadlines
│   ├── farm_campaign_settlement/ # Campaign liquidation & investor payouts
│   ├── marketplace_settlement/   # Secondary trade settlement & swap execution
│   ├── project_factory/          # Deterministic contract deployment factory
│   └── revenue_distributor/      # Harvest profit sharing & dividend payouts
└── target/
    └── wasm32-unknown-unknown/
        └── release/              # Compiled WebAssembly binaries (*.wasm)
```

### Contracts Overview

| Contract | Primary Responsibilities | Key Dependencies |
|---|---|---|
| `escrow` | Milestone-based funding release, investor refunds, dispute freezes | SEP-41 Token (USDC), Admin auth |
| `farm_campaign` | Campaign parameters, investor allocations, funding targets | Project Factory, Token |
| `farm_campaign_settlement` | Final settlement calculation upon harvest delivery | Farm Campaign, Escrow |
| `marketplace_settlement` | Order matching, atomic token-for-asset swaps | Token, Factory |
| `project_factory` | Deploying campaign and escrow instances dynamically | Soroban Deployer |
| `revenue_distributor` | Pro-rata dividend distribution to verified token holders | Token, KYC Registry |

---

## 2. Smart Contract Implementation Architecture

### Storage Models & State Management

Soroban provides three distinct storage types. Choosing the correct storage type is critical for data persistence and gas/rent optimization:

1. **Instance Storage (`env.storage().instance()`)**:
   - Tied directly to the contract instance lifetime.
   - Ideal for contract-wide configuration: `Admin`, `UsdcToken`, `DealValue`, `FundingDeadline`, and state flags (`OperationInProgress`).
   - Automatically loaded on every contract invocation.
2. **Persistent Storage (`env.storage().persistent()`)**:
   - Stored independently of the contract instance with separate TTL rent management.
   - Ideal for unbounded user-specific data, such as `Investors` maps or balance ledgers.
   - Can be restored from archival state if rent expires.
3. **Temporary Storage (`env.storage().temporary()`)**:
   - Ephemeral storage that is deleted when TTL expires without archival.
   - Ideal for nonces, rate-limiting windows, or short-lived challenge tokens.

#### State Key Patterns

Always declare storage keys inside a typed enum marked with `#[contracttype]`:

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Farmer,
    Platform,
    UsdcToken,
    DealValue,
    TotalFunded,
    Released,
    MilestonesCount,
    Investors,
    OperationInProgress,
}
```

#### Complex Structs

Mark all custom state structures with `#[contracttype]`:

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub completed: bool,
    pub timestamp: u64,
}
```

### Authorization & Multi-Role Guards

Soroban uses address-based cryptographic authentication. Never rely on caller checks without enforcing authorization:

```rust
// Verify caller identity and signature:
caller.require_auth();

// Restrict administrative actions:
let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
if caller != admin {
    return Err(Error::Unauthorized);
}
```

#### Guarding Against Concurrent Operations

For sensitive multi-step actions (such as releasing funds or executing contract upgrades), use an operational guard:

```rust
if env.storage().instance().get(&DataKey::OperationInProgress).unwrap_or(false) {
    return Err(Error::OperationInProgress);
}
env.storage().instance().set(&DataKey::OperationInProgress, &true);

// ... perform sensitive logic ...

env.storage().instance().set(&DataKey::OperationInProgress, &false);
```

### Cross-Contract Invocations & Token Interactions

Interacting with Stellar assets (such as USDC) is performed through the Soroban Token Interface (`soroban_sdk::token::Client`):

```rust
use soroban_sdk::{token, Address, Env};

pub fn transfer_funds(
    env: &Env,
    token_address: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    let client = token::Client::new(env, token_address);
    client.transfer(from, to, &amount);
}
```

### Error Handling & Revert Mechanics

Define custom errors using `#[contracterror]` with explicit discriminants:

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized                   = 1,
    NotInitialized                 = 2,
    AlreadyInitialized             = 3,
    InvalidAmount                  = 4,
    InvalidShares                  = 5,
    AlreadyReleased                = 6,
    BalanceInsufficient            = 7,
    DeliveryNotApproved            = 8,
    InvalidMilestones              = 9,
    MilestoneAlreadyRecorded       = 10,
    InsufficientMilestonesCompleted = 11,
    NoInvestors                    = 12,
    DeadlineNotPassed              = 13,
    TargetMet                      = 14,
    NothingToRefund                = 15,
    ContributorFrozen              = 16,
    NotFrozen                      = 17,
    OperationInProgress            = 18,
}
```

Returning `Err(Error::...)` immediately halts execution and rolls back all ledger state modifications made during the transaction.

### Storage Rent, Footprints, & Fee Considerations

- **Rent Extension**: All live contracts must periodically extend their instance storage TTL to avoid being archived:
  ```rust
  env.storage().instance().extend_ttl(535_680, 535_680); // ~30 days in ledgers
  ```
- **Read/Write Footprints**: Soroban requires declaring ledger footprints. Minimizing storage key sizes and avoiding huge maps in single keys ensures transactions remain within resource bounds.
- **Resource Limits**: Keep WASM binaries under 64KB for optimal execution fees and low verification costs.

---

## 3. Testing Harness & Simulation

All contracts must include unit and integration tests located in `src/test.rs` using the Soroban SDK test harness:

```rust
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_release() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let platform = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract(admin.clone());

        client.initialize(
            &admin,
            &farmer,
            &platform,
            &usdc,
            &100_000_000,
            &3,
            &soroban_sdk::vec![&env, admin.clone()],
            &1735689600,
        );

        assert_eq!(client.get_total_funded(), 0);
    }
}
```

### Running Tests

```bash
# Run all contract tests in workspace
make test

# Run tests for a specific crate
cargo test -p escrow

# Run with stdout logging enabled
cargo test -p escrow -- --nocapture
```

---

## 4. Compilation & Deployment Workflow

### Step 1: Compile to WebAssembly

```bash
# Build all contracts with release optimizations
make build

# Or build individual contract
make build-escrow
```

The resulting WASM binary is generated at:
`blockchain/target/wasm32-unknown-unknown/release/escrow.wasm`

### Step 2: Install WASM onto Network

Installing the WASM computes and stores the bytecode on-chain, returning a 32-byte hexadecimal hash:

```bash
soroban contract install \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source <DEPLOYER_SECRET_KEY>
```

Output: `<WASM_HASH_HEX_STRING>` (e.g., `a1b2c3d4...`)

### Step 3: Instantiate Contract Instance

```bash
soroban contract deploy \
  --wasm-hash <WASM_HASH_HEX_STRING> \
  --network testnet \
  --source <DEPLOYER_SECRET_KEY>
```

Output: `<CONTRACT_ID>` (e.g., `CA...`)

### Step 4: Initialize Contract

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <ADMIN_SECRET_KEY> \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --farmer <FARMER_ADDRESS> \
  --platform <PLATFORM_ADDRESS> \
  --usdc_token <USDC_CONTRACT_ID> \
  --deal_value 50000000000 \
  --milestone_count 3 \
  --investors '[]' \
  --funding_deadline 1735689600
```

---

## 5. Upgrades & Multi-Sig Governance

### Upgrade Pattern

Agri-Fi contracts implement in-place WASM upgrades via `env.deployer().update_current_contract_wasm(...)`. This retains the contract ID and all existing storage while swapping the executable bytecode:

```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    caller.require_auth();
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    if caller != admin {
        return Err(Error::Unauthorized);
    }
    if env.storage().instance().get(&DataKey::OperationInProgress).unwrap_or(false) {
        return Err(Error::OperationInProgress);
    }

    env.deployer().update_current_contract_wasm(new_wasm_hash);
    env.events().publish((symbol_short!("upgrade"),), true);
    Ok(())
}
```

### Multi-Sig Redeployment Steps

1. **Compile and Verify New WASM**:
   ```bash
   make build
   make test
   ```
2. **Install New WASM**:
   ```bash
   soroban contract install --wasm target/wasm32-unknown-unknown/release/escrow.wasm --network testnet --source <SIGNER_KEY>
   ```
3. **Assemble Multi-Sig Upgrade Transaction**:
   The admin address is typically a multi-signature account requiring M-of-N threshold signatures.
   Assemble the invoke transaction targeting `upgrade(caller, new_wasm_hash)`:
   ```bash
   soroban contract invoke \
     --id <EXISTING_CONTRACT_ID> \
     --network testnet \
     --source <MULTISIG_COORDINATOR> \
     -- upgrade \
     --caller <MULTISIG_ADMIN_ADDRESS> \
     --new_wasm_hash <NEW_WASM_HASH>
   ```
4. **Collect Signatures & Submit**:
   Distribute the transaction XDR to required signers, collect signatures, and submit via Stellar Horizon or RPC.
5. **Post-Upgrade Verification**:
   - Query existing state fields (e.g. `get_total_funded`) to confirm storage continuity.
   - Verify the `upgrade` event was emitted on the ledger.
   - Run integration smoke tests against the updated contract ID.

---

## 6. Backend Integration (Listener & Indexer)

When contracts emit events, the backend listens and updates application databases.

### Contract Event Emission Pattern

Soroban events consist of up to 4 topics and a data payload:

```rust
// Emitting a status event
env.events().publish((symbol_short!("approve"),), deal_id);

// Emitting a settlement event
env.events().publish((symbol_short!("settled"),), total_funded);

// Emitting an upgrade event
env.events().publish((symbol_short!("upgrade"),), true);
```

### Backend Listener Architecture

The backend monitors events via `SorobanListenerService` (`backend/src/soroban/soroban-listener.service.ts`):
- Runs every 30 seconds via `@Cron('*/30 * * * * *')`.
- Calls `rpcServer.getEvents({ startLedger, filters: [{ type: 'contract', contractIds }] })`.
- Converts topics using `scValToNative(topic[0])`.

### Adding or Changing Events Checklist

When modifying contract event topics or payloads:
1. **Maintain Backwards Compatibility**: Do not remove old event names if historical blocks need re-indexing.
2. **Update Listener Handlers**:
   In `backend/src/soroban/soroban-listener.service.ts`:
   ```typescript
   switch (eventName) {
     case 'approve':
       deal.status = 'open';
       break;
     case 'pause':
     case 'mark_failed':
       deal.status = 'failed';
       break;
     case 'distribute_revenue':
       deal.status = 'completed';
       break;
     case 'your_new_event':
       // Handle new contract event
       break;
   }
   ```
3. **Update Indexer Handlers**:
   In `backend/src/soroban/soroban-event-indexer.service.ts`, add appropriate processing logic to persist event records into `investment_events` or `transaction_logs`.
4. **Regenerate TypeScript Bindings**:
   ```bash
   stellar contract bindings typescript \
     --wasm blockchain/target/wasm32-unknown-unknown/release/escrow.wasm \
     --output-dir frontend/src/contracts/escrow \
     --overwrite
   ```

---

## 7. Developer Checklist

Before opening a PR touching smart contracts:

- [ ] All contracts compile cleanly with `make build`.
- [ ] All unit and integration tests pass with `make test`.
- [ ] No contract exceeds the 64KB target size (`make sizes`).
- [ ] Storage keys use typed `DataKey` enum variants.
- [ ] State upgrades maintain backward storage layout compatibility.
- [ ] Authorization checks (`require_auth`) protect all state-mutating functions.
- [ ] Event emissions match backend listener topic names in `SorobanListenerService`.
- [ ] If contract interface changed, generated TypeScript bindings were updated.
