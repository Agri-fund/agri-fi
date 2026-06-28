# Agri-Fi Blockchain - Soroban Smart Contracts

Rust smart contracts for the Agri-Fi platform using the Soroban platform on Stellar.

## Quick Start

### 1. Set Up Environment

```bash
make soroban-up
```

### 2. Build Contracts

```bash
make build-docker
```

### 3. Run Tests

```bash
make test-docker
```

## Installation

### Prerequisites

- Docker & Docker Compose (recommended)
- Rust (optional, for local development)

### Local Rust Setup

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install stellar-cli
```

## Development Commands

### Common Tasks

```bash
make help              # Show all commands
make build            # Build all contracts
make test             # Run all tests
make build-escrow     # Build specific contract
make test-escrow      # Test specific contract
make soroban-up       # Start services
make soroban-down     # Stop services
make deploy-local     # Deploy to local network
```

### Using Cargo

```bash
cargo wasm            # Build WASM
cargo test-wasm       # Test WASM
cargo clippy-wasm     # Lint WASM
```

## Project Structure

```
blockchain/
├── Cargo.toml                    # Workspace configuration
├── Makefile                      # Development commands
├── SOROBAN_DEVELOPMENT.md        # Comprehensive guide
├── .cargo/config.toml           # Cargo settings
├── contracts/
│   ├── escrow/                  # Escrow (Issue #345)
│   ├── farm_campaign/
│   ├── farm_campaign_settlement/
│   ├── marketplace_settlement/
│   ├── project_factory/
│   └── revenue_distributor/
└── target/
    └── wasm32-unknown-unknown/
        └── release/             # WASM binaries
```

## Building

### Build All Contracts

```bash
make build
# or
cargo build --release --target wasm32-unknown-unknown
```

### Build Specific Contract

```bash
make build-escrow
```

### Verify WASM Created

```bash
make check-wasm
```

## Testing

### Run All Tests

```bash
make test
cargo test
```

### Test Specific Contract

```bash
make test-escrow
cargo test -p escrow
```

### Test with Output

```bash
cargo test -- --nocapture
```

## Deployment

### Deploy Locally

```bash
make deploy-local
```

### Deploy to Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet
```

## Docker Services

Services defined in `docker-compose.yml`:

- **soroban**: CLI container for building and testing
- **soroban-rpc**: RPC server on port 8000

Start services:
```bash
docker-compose up -d soroban soroban-rpc
```

## Documentation

- [SOROBAN_DEVELOPMENT.md](SOROBAN_DEVELOPMENT.md) - Comprehensive guide
- [contracts/escrow/ESCROW_CONTRACT.md](contracts/escrow/ESCROW_CONTRACT.md) - Escrow contract

## Issues Addressed

- **Issue #345** - Soroban escrow smart contract
- **Issue #346** - Development environment configuration

## Resources

- [Soroban Docs](https://developers.stellar.org/learn/build/smart-contracts)
- [Soroban SDK](https://docs.rs/soroban-sdk/)
- [Stellar Dev Center](https://developers.stellar.org/)

## Troubleshooting

**wasm32 target not found:**
```bash
rustup target add wasm32-unknown-unknown
```

**Docker not found:**
Install Docker Desktop or Docker Engine.

**Tests won't run:**
```bash
docker-compose up -d soroban
```

## Support

- Check [SOROBAN_DEVELOPMENT.md](SOROBAN_DEVELOPMENT.md)
- Visit [Stellar Discord](https://discord.gg/stellardev)
- Open GitHub issue (reference Issue #346)

---

**Status**: Soroban development environment integration complete (Issue #346)
