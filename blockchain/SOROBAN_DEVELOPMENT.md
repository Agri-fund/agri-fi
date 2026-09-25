# Soroban Development Environment Setup

## Overview

This guide explains how to set up and use the Soroban Rust SDK development environment for building, testing, and deploying Stellar smart contracts.

## Issue

**Issue #346**: Integrate Soroban Rust SDK in development environment configurations

The development environment provides tools to compile, test, and deploy Rust smart contracts locally using Docker and the Soroban CLI.

## Prerequisites

- Docker and Docker Compose
- Rust (for local development without Docker)
- Git

## Quick Start

### 1. Start the Soroban Development Environment

```bash
docker-compose up -d soroban soroban-rpc
```

This starts:
- **soroban-cli**: Soroban command-line interface for contract deployment
- **soroban-rpc**: Local Soroban RPC server for contract testing

### 2. Build Smart Contracts

Build all contracts in the workspace:

```bash
docker-compose exec soroban cargo build --release --target wasm32-unknown-unknown
```

Or build locally (if Rust is installed):

```bash
cd blockchain
cargo build --release --target wasm32-unknown-unknown
```

### 3. Run Tests

Run all contract tests:

```bash
docker-compose exec soroban cargo test
```

Test a specific contract:

```bash
docker-compose exec soroban cargo test -p escrow
```

### 4. Access the Soroban CLI

Enter the Soroban container:

```bash
docker-compose exec soroban bash
```

Then use Soroban commands:

```bash
# Check Soroban version
soroban --version

# Deploy a contract
soroban contract deploy --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm

# Invoke a contract function
soroban contract invoke --id <contract-id> -- initialize --admin <address> ...
```

## Project Structure

### Cargo Workspace

The `blockchain/Cargo.toml` defines the workspace with all smart contracts:

```
blockchain/
├── Cargo.toml              # Workspace configuration
├── Cargo.lock
└── contracts/
    ├── escrow/             # Escrow contract (Issue #345)
    ├── farm_campaign/      # Farm campaign contract
    ├── farm_campaign_settlement/ # Campaign settlement
    ├── marketplace_settlement/   # Marketplace settlement
    ├── project_factory/    # Project factory
    └── revenue_distributor/ # Revenue distribution
```

Each contract is a Rust crate with:
- `src/lib.rs` - Contract implementation
- `src/test.rs` - Unit tests
- `Cargo.toml` - Package configuration

### Soroban in Docker Compose

The `docker-compose.yml` includes:

**soroban** service:
- Image: `stellar/soroban-preview:latest`
- Volume mounts: Contract source code
- Purpose: Contract compilation and testing environment

**soroban-rpc** service:
- Image: `stellar/soroban-preview:latest`
- Port: `8000` (Soroban RPC endpoint)
- Purpose: Local RPC server for contract interaction

## Building Contracts

### Build All Contracts

Build all contracts with optimizations for WASM:

```bash
cargo build --release --target wasm32-unknown-unknown
```

Output WASM binaries are in:
```
target/wasm32-unknown-unknown/release/*.wasm
```

### Build-Specific Contract

Build only the escrow contract:

```bash
cargo build -p escrow --release --target wasm32-unknown-unknown
```

### Build Configuration

The workspace defines optimized release settings in `Cargo.toml`:

```toml
[profile.release]
opt-level = "z"           # Optimize for size
overflow-checks = true    # Keep overflow checks
debug = 0                 # No debug info
strip = "symbols"         # Strip symbols
debug-assertions = false  # Remove debug assertions
panic = "abort"          # Abort on panic (smaller binaries)
codegen-units = 1        # Better optimization
lto = true               # Link-time optimization
```

These settings produce small, efficient WASM binaries suitable for deployment.

## Testing Contracts

### Run All Tests

```bash
cargo test
```

### Test Specific Contract

Test the escrow contract:

```bash
cargo test -p escrow
```

### Test with Logging

Run tests with output:

```bash
cargo test -- --nocapture
```

### Test Coverage

Each contract includes comprehensive unit tests in `src/test.rs`:
- State initialization
- Authorization checks
- Method validation
- Error conditions
- Integration scenarios

Example test run output:

```
running 25 tests

test test_initialize ... ok
test test_record_milestone_by_admin ... ok
test test_record_same_milestone_twice_fails ... ok
test test_settle_escrow_distributes_98_to_farmer_2_to_platform ... ok

test result: ok. 25 passed; 0 failed; 0 ignored; 0 measured
```

## Contract Upgrade & Migration Strategy

### Overview

Smart contracts evolve over time through bug fixes, feature additions, and optimizations. This section defines when to upgrade existing contracts versus deploy new instances, and provides a safe upgrade process that protects active campaigns and ensures storage compatibility.

### Upgrade vs Redeploy Decision

#### When to Upgrade (In-Place)

Upgrade existing contract instances when:
- **Bug fixes** that don't change storage structure
- **Performance optimizations** maintaining backward compatibility
- **Adding new functions** without removing existing ones
- **Event schema additions** (new event types, not modifications)
- **Gas optimizations** that don't affect storage layout
- **Compliance enhancements** with additive changes only

**Use Case:** Active campaigns are running and need immediate fixes without disrupting ongoing operations.

#### When to Redeploy (New Instance)

Deploy new contract instances when:
- **Breaking storage changes** (removing or restructuring DataKey fields)
- **Event schema modifications** (changing existing event signatures)
- **API-breaking changes** (removing or modifying function signatures)
- **Major architectural changes** (fundamental logic restructuring)
- **Security patches requiring storage migration**
- **Protocol-level changes** affecting contract behavior

**Use Case:** New campaigns or when storage migration complexity outweighs upgrade benefits.

### Safe Upgrade Process

#### Prerequisites

1. **Active Campaign Audit**
   - Identify all active campaigns using the contract
   - Document current storage state and critical data
   - Verify campaign statuses (Open, Funded, Active, etc.)

2. **Multi-Sig Threshold Setup**
   - Ensure admin wallet has required multi-sig configuration
   - Set appropriate signature threshold (minimum 2/3 for production)
   - Test multi-sig functionality on testnet first

3. **Backup & Rollback Plan**
   - Export current contract state
   - Document rollback procedure
   - Prepare emergency fund addresses if needed

#### Upgrade Steps

##### 1. Staging Deployment

```bash
# Build new version
cargo build -p escrow --release --target wasm32-unknown-unknown

# Deploy to testnet/staging network
soroban contract deploy \
  --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source <admin-signer>
```

##### 2. Comprehensive Testing

```bash
# Run unit tests
cargo test -p escrow -- --nocapture

# Run integration tests against staging deployment
soroban contract invoke \
  --id <staging-contract-id> \
  --network testnet \
  -- initialize \
  --admin <test-admin> \
  --farmer <test-farmer> \
  --platform <test-platform> \
  --usdc_token <test-usdc> \
  --deal_value 10000000000 \
  --milestone_count 3 \
  --investors '[<test-investor1>, <test-investor2>]' \
  --funding_deadline 1234567890

# Test all critical paths
# - Funding and refunds
# - Milestone recording
# - Settlement and distribution
# - Compliance features (freeze/unfreeze)
```

##### 3. Storage Compatibility Verification

```bash
# Verify storage keys haven't changed for active campaigns
soroban contract inspect \
  --id <current-contract-id> \
  --network public \
  --output storage_snapshot.json

# Compare with new contract storage schema
soroban contract inspect \
  --id <staging-contract-id> \
  --network testnet \
  --output storage_schema.json

# Verify no breaking changes
python scripts/verify_storage_compat.py storage_snapshot.json storage_schema.json
```

##### 4. Multi-Sig Authorization

```bash
# Prepare upgrade transaction (don't execute yet)
soroban contract invoke \
  --id <current-contract-id> \
  --network public \
  -- upgrade \
  --new_wasm_hash <new-wasm-hash> \
  --admin <admin-address> \
  --prepare-only > upgrade_transaction.xdr

# Get multi-sig signers to sign
soroban transaction sign \
  --file upgrade_transaction.xdr \
  --signer <signer1> \
  --output signed1.xdr

soroban transaction sign \
  --file signed1.xdr \
  --signer <signer2> \
  --output signed2.xdr

# Continue until threshold is met
```

##### 5. On-Chain Upgrade

```bash
# Execute upgrade with sufficient signatures
soroban transaction submit \
  --file signed_final.xdr \
  --network public

# Verify upgrade succeeded
soroban contract info \
  --id <current-contract-id> \
  --network public
```

##### 6. Post-Upgrade Synthetic Checks

```bash
# Verify contract is still functional
soroban contract invoke \
  --id <current-contract-id> \
  --network public \
  -- get_deal_value

# Test read-only functions first
soroban contract invoke \
  --id <current-contract-id> \
  --network public \
  -- get_total_funded

# Monitor for 24-48 hours before enabling write operations
# Check for anomalies in event logs and storage state
```

##### 7. Active Campaign Validation

```bash
# Verify active campaigns still work correctly
for campaign_id in $(cat active_campaigns.txt); do
  soroban contract invoke \
    --id $campaign_id \
    --network public \
    -- get_state
done

# Check milestone progress is preserved
soroban contract invoke \
  --id <campaign-id> \
  --network public \
  -- get_milestones_completed
```

### Storage Compatibility Rules

#### Golden Rules

1. **Never Remove Active Storage Keys**
   - Once a `DataKey` is used in production, never remove it
   - Deprecated keys can be marked but must remain readable
   - Use versioned keys for breaking changes (e.g., `InvestorsV2`)

2. **Additive Changes Only**
   - Adding new storage keys is always safe
   - Adding new fields to structs is safe if default values are provided
   - Adding new enum variants requires careful migration planning

3. **Type Evolution Guidelines**
   - Never change the type of an existing storage key
   - Numeric types can only be widened (i32 → i64, not reverse)
   - Map key types must remain compatible (Address → Address only)

4. **Migration Planning**
   - For breaking changes, implement migration functions
   - Provide data migration path from old to new schema
   - Test migration with staging data before production

#### Storage Key Evolution

**Safe Evolution:**
```rust
// Adding new keys (always safe)
DataKey::NewFeature,
DataKey::NewSettings,

// Adding to existing maps (safe)
Map<Address, i128> → Map<Address, (i128, Metadata)>
```

**Unsafe Evolution (requires redeploy):**
```rust
// Removing keys (unsafe)
// DataKey::OldFeature, // ❌ Never remove

// Changing key types (unsafe)
Map<Address, i128> → Map<u32, i128> // ❌ Breaking change

// Restructuring (unsafe)
Struct with field removal → needs migration plan
```

#### Migration Patterns

**Pattern 1: Deprecation with Migration**
```rust
// Old storage (keep for migration)
DataKey::InvestorsV1, // Deprecated but kept

// New storage
DataKey::InvestorsV2, // New version

// Migration function
pub fn migrate_investors(env: Env) -> Result<(), Error> {
    let old_data: Map<Address, i128> = env.storage()
        .instance()
        .get(&DataKey::InvestorsV1)
        .unwrap();
    
    let mut new_data: Map<Address, InvestorInfo> = Map::new(&env);
    for (addr, amount) in old_data.iter() {
        new_data.set(addr, InvestorInfo { amount, metadata: None });
    }
    
    env.storage().instance().set(&DataKey::InvestorsV2, &new_data);
    Ok(())
}
```

**Pattern 2: Dual-Write During Transition**
```rust
// Write to both old and new during transition
pub fn fund_with_migration(env: Env, investor: Address, amount: i128) {
    // Write to old storage
    let mut old_investors: Map<Address, i128> = env.storage()
        .instance()
        .get(&DataKey::InvestorsV1)
        .unwrap();
    old_investors.set(investor.clone(), amount);
    env.storage().instance().set(&DataKey::InvestorsV1, &old_investors);
    
    // Write to new storage
    let mut new_investors: Map<Address, InvestorInfo> = env.storage()
        .instance()
        .get(&DataKey::InvestorsV2)
        .unwrap_or(Map::new(&env));
    new_investors.set(investor, InvestorInfo { amount, metadata: None });
    env.storage().instance().set(&DataKey::InvestorsV2, &new_investors);
}
```

### Redeploy Metadata & Configuration

#### Address Registry

When redeploying contracts, maintain an address registry for environment-specific configurations:

```toml
# blockchain/addresses.toml

[networks.testnet]
escrow = "CABC123..."
farm_campaign = "CDEF456..."
usdc_token = "GAAAAA..."
platform = "GBBBBB..."

[networks.public]
escrow = "CXYZ789..."
farm_campaign = "CUVW012..."
usdc_token = "GCCCCC..."
platform = "GDDDDD..."
```

#### Environment-Specific Configs

Different networks require different parameters:

```bash
# Testnet configuration
--funding_deadline 9999999999  # Far future for testing
--platform_fee_bps 200         # Higher fees for testing
--milestone_count 5            # More milestones for testing

# Mainnet configuration
--funding_deadline 1735689600  # Real deadline
--platform_fee_bps 100         # Production fees
--milestone_count 3            # Production milestones
```

#### Indexer Re-pointing

When contracts are redeployed, update indexer configurations:

```yaml
# indexer/config.yaml
contracts:
  escrow:
    testnet: "CABC123..."
    public: "CXYZ789..."  # Update on redeploy
  farm_campaign:
    testnet: "CDEF456..."
    public: "CUVW012..."  # Update on redeploy

event_schemas:
  escrow:
    version: "2.0"  # Update on breaking event changes
```

#### Documentation Updates

Update all documentation to reflect new contract addresses:

```markdown
## Current Contract Addresses

### Testnet
- Escrow: `CABC123...`
- Farm Campaign: `CDEF456...`

### Mainnet
- Escrow: `CXYZ789...` (updated 2026-09-24)
- Farm Campaign: `CUVW012...` (updated 2026-09-24)
```

### Upgrade Checklist

Before attempting an upgrade:

- [ ] All active campaigns identified and documented
- [ ] Storage compatibility verified with staging data
- [ ] Multi-sig threshold configured and tested
- [ ] Comprehensive tests passed on staging
- [ ] Rollback plan documented and tested
- [ ] Backup of current contract state taken
- [ ] Team notification and approval obtained
- [ ] Monitoring and alerting configured
- [ ] Support team briefed on potential issues

After upgrade completion:

- [ ] Contract info verified (WASM hash updated)
- [ ] Read-only functions tested successfully
- [ ] Sample active campaigns validated
- [ ] Event logs monitored for anomalies
- [ ] Performance metrics checked
- [ ] Documentation updated with new addresses/versions
- [ ] Indexer configurations updated
- [ ] Post-upgrade monitoring period completed (24-48h)

### Emergency Rollback

If upgrade fails or critical issues are discovered:

1. **Immediate Actions**
   ```bash
   # Revert to previous WASM using upgrade function
   soroban contract invoke \
     --id <contract-id> \
     --network public \
     -- upgrade \
     --new_wasm_hash <previous-wasm-hash> \
     --admin <admin-address>
   ```

2. **Investigation**
   - Review event logs for error patterns
   - Check storage state for corruption
   - Analyze failed transactions

3. **Communication**
   - Notify stakeholders of rollback
   - Document root cause
   - Plan fix for next upgrade attempt

### Security Considerations

#### Upgrade Security

- **Multi-sig Requirement**: Never use single-signer wallets for production upgrades
- **Time-Lock**: Consider implementing time-locked upgrades for critical contracts
- **Audit Trail**: Maintain logs of all upgrade attempts and approvals
- **Access Control**: Restrict upgrade permissions to authorized admin accounts only

#### Storage Security

- **Sensitive Data**: Never store private keys or secrets in contract storage
- **Access Patterns**: Design storage access to minimize gas costs
- **Data Validation**: Validate all external data before storage
- **Backup Strategy**: Regularly backup critical contract state

---

## Deployment

### Deploy to Local Network

1. **Build the contract:**
```bash
cargo build -p escrow --release --target wasm32-unknown-unknown
```

2. **Deploy with Soroban CLI:**
```bash
docker-compose exec soroban soroban contract deploy \
  --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm \
  --network standalone
```

3. **Get the contract ID:**
The CLI returns the contract address (e.g., `CABC123...`)

### Deploy to Testnet

```bash
soroban contract deploy \
  --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source <your-testnet-account>
```

### Deploy to Mainnet

```bash
soroban contract deploy \
  --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm \
  --network public \
  --source <your-mainnet-account>
```

## Development Workflow

### 1. Make Contract Changes

Edit contract code in `contracts/<contract>/src/lib.rs`:

```rust
pub fn new_method(env: Env, param: Type) -> Result<(), Error> {
    // Implementation
    Ok(())
}
```

### 2. Add Tests

Add tests in `contracts/<contract>/src/test.rs`:

```rust
#[test]
fn test_new_method() {
    let setup = setup();
    let result = setup.client.new_method(&param);
    assert!(result.is_ok());
}
```

### 3. Build and Test

```bash
cargo build --release --target wasm32-unknown-unknown
cargo test
```

### 4. Deploy and Verify

```bash
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/escrow.wasm
# Test contract interactions
```

### 5. Commit Changes

```bash
git add blockchain/contracts/escrow/src/
git commit -m "feat: Add new_method to escrow contract"
```

## Soroban CLI Commands

### Common Commands

**Deploy a contract:**
```bash
soroban contract deploy --wasm ./contract.wasm --network testnet
```

**Invoke a contract function:**
```bash
soroban contract invoke \
  --id CABC123... \
  --network testnet \
  -- initialize \
  --admin GXXXXXX \
  --farmer GYYYYYY
```

**Get contract info:**
```bash
soroban contract info --id CABC123... --network testnet
```

**View contract events:**
```bash
soroban contract events --id CABC123... --network testnet
```

## Environment Variables

Configure Soroban behavior with environment variables:

```bash
# RPC endpoint
export SOROBAN_RPC_HOST=http://localhost:8000
export SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc

# Network
export NETWORK=testnet

# Account
export SOROBAN_ACCOUNT=<your-account-id>
```

## Troubleshooting

### Build Fails with "wasm32 target not found"

Install the wasm32 target:
```bash
rustup target add wasm32-unknown-unknown
```

### Soroban Container Won't Start

Check Docker is running:
```bash
docker ps
```

Pull the latest image:
```bash
docker pull stellar/soroban-preview:latest
```

### RPC Connection Errors

Verify RPC is running:
```bash
docker-compose ps soroban-rpc
```

Check RPC health:
```bash
curl http://localhost:8000/soroban/rpc
```

### Test Failures

Enable test output:
```bash
RUST_LOG=debug cargo test -- --nocapture
```

Run single test:
```bash
cargo test test_initialize -- --nocapture
```

## Performance Tips

### Fast Compilation

Use debug builds for faster compilation:
```bash
cargo build --target wasm32-unknown-unknown
```

(Note: Only use release builds for deployment)

### Parallel Testing

Run tests in parallel:
```bash
cargo test -- --test-threads=4
```

### Link-time Optimization

Disable LTO for faster builds:
```bash
cargo build --target wasm32-unknown-unknown --config profile.release.lto=false
```

## Resources

- [Soroban Documentation](https://developers.stellar.org/learn/build/smart-contracts)
- [Soroban Rust SDK](https://docs.rs/soroban-sdk/)
- [Stellar Developer Center](https://developers.stellar.org/)
- [Soroban Examples](https://github.com/stellar/soroban-examples)
- [Stellar Discord Community](https://discord.gg/stellardev)

## Development Tools

### Recommended IDE Extensions

**VS Code**
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [Crates](https://marketplace.visualstudio.com/items?itemName=serayuzgur.crates)

**IntelliJ/CLion**
- Rust plugin (built-in)
- Toml support

### Local Setup (Without Docker)

Install Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Add wasm32 target:
```bash
rustup target add wasm32-unknown-unknown
```

Install Soroban CLI:
```bash
cargo install stellar-cli
```

## Next Steps

1. **Build the Escrow Contract:**
   ```bash
   cargo build -p escrow --release --target wasm32-unknown-unknown
   ```

2. **Run Escrow Tests:**
   ```bash
   cargo test -p escrow
   ```

3. **Deploy Locally:**
   ```bash
   soroban contract deploy --wasm ./target/wasm32-unknown-unknown/release/escrow.wasm
   ```

4. **Test Contract Interactions:**
   ```bash
   soroban contract invoke --id <contract-id> -- initialize ...
   ```

## Support

For issues or questions:
- Check [Soroban FAQ](https://developers.stellar.org/docs/learn/smart-contracts)
- Post in [Stellar Discord](https://discord.gg/stellardev)
- Open an issue on GitHub (reference Issue #346)

---

## Changelog

### 2026-09-24 — Contract Upgrade & Migration Strategy Documentation

- Added comprehensive contract upgrade & migration strategy section
- Documented upgrade vs redeploy decision criteria
- Added safe upgrade process with multi-sig requirements
- Included storage compatibility rules and migration patterns
- Documented redeploy metadata and address registry requirements
- Added upgrade checklists and emergency rollback procedures
- Linked upgrade strategy from contracts README

### 2026-09-24 — Escrow Contract Compliance Features

- Added frozen contributor functionality for regulatory compliance
- Implemented `freeze_contributor()` and `unfreeze_contributor()` admin functions
- Added frozen flag checks in all payout paths (refunds and settlements)
- Implemented `compliance_halt` event emission for blocked transfers
- Added comprehensive compliance test coverage
- Updated error codes with `ContributorFrozen` (16) and `NotFrozen` (17)

### 2026-09-24 — Escrow Contract Funding Deadline & Refunds

- Added `get_funding_deadline()` view function for deadline queries
- Implemented `target_met()` query function for funding status
- Added `refund_after_expiry()` with idempotent behavior for individual refunds
- Implemented `refund_all_after_expiry()` batch refund function (admin-only)
- Added comprehensive deadline boundary and refund tests
- Updated error codes with `DeadlineNotPassed` (13), `TargetMet` (14), and `NothingToRefund` (15)

### 2026-08-29 — Soroban Smart Contract Enhancements

#### Issue #714 — Integration Tests for Project Factory Contracts
- Added comprehensive integration tests in `blockchain/contracts/project_factory/src/test.rs`
- 12 tests covering initialization, campaign registration, authorization, and edge cases
- Verifies factory contract deploys and registers child campaign contracts with correct configuration parameters

#### Issue #716 — Optimize Storage Collections in Rust
- Replaced `Vec<Address>` with `Map<Address, i128>` in the escrow contract for O(1) investor lookups
- Optimized `distribute_revenue` in `farm_campaign` to iterate directly over the Map, removing intermediate Vec allocations
- Gas savings: eliminates unnecessary linear scans during milestone settlement and revenue distribution

#### Issue #715 — Third-Party Dispute Resolution
- Added `arbitrator` field to `Config` struct in `farm_campaign` contract
- `raise_dispute(caller, milestone_index)` — admin or farmer can flag a milestone dispute
- `resolve_dispute(arbitrator, milestone_index, approve)` — arbitrator approves or denies disputed milestones
- `update_arbitrator(admin, new_arbitrator)` — admin can rotate the arbitrator address
- Dispute flag blocks milestone payouts until arbitrator resolves; payout routing follows arbitrator decision
- New error variants: `DisputeActive` (15) and `NoDispute`

---

**Status**: Development environment integration complete (Issue #346)  
**Last Updated**: 2026-08-29  
**Maintainer**: Blockchain Team
