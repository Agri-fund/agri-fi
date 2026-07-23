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

**Status**: Development environment integration complete (Issue #346)  
**Last Updated**: 2026-06-28  
**Maintainer**: Blockchain Team
