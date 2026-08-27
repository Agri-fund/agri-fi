# Makefile for Soroban Smart Contracts
# Issue #346 - Integrate Soroban Rust SDK in development environment

.PHONY: help build build-docker test test-docker clean check-wasm deploy-local soroban-shell

# Default target
help:
	@echo "Soroban Smart Contracts Development Commands"
	@echo ""
	@echo "Building:"
	@echo "  make build              - Build all contracts locally (requires Rust)"
	@echo "  make build-docker       - Build contracts in Docker container"
	@echo "  make build-escrow       - Build only escrow contract"
	@echo "  make check-wasm         - Verify WASM binaries were created"
	@echo ""
	@echo "Testing:"
	@echo "  make test               - Run all tests locally (requires Rust)"
	@echo "  make test-docker        - Run all tests in Docker container"
	@echo "  make test-escrow        - Test only escrow contract"
	@echo ""
	@echo "Environment:"
	@echo "  make soroban-up         - Start Soroban services (Docker Compose)"
	@echo "  make soroban-down       - Stop Soroban services"
	@echo "  make soroban-shell      - Enter Soroban CLI container"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean              - Remove build artifacts"
	@echo "  make clean-docker       - Remove Docker volumes and images"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-local       - Deploy contracts to local network"
	@echo ""

# ===== Building =====

# Build all contracts locally (requires Rust)
build:
	@echo "Building all Soroban contracts locally..."
	cargo build --release --target wasm32-unknown-unknown
	@echo "✓ Build complete. WASM files in: target/wasm32-unknown-unknown/release/"

# Build all contracts in Docker
build-docker:
	@echo "Building contracts in Docker..."
	docker-compose exec soroban cargo build --release --target wasm32-unknown-unknown
	@echo "✓ Docker build complete."

# Build only escrow contract
build-escrow:
	@echo "Building escrow contract..."
	cargo build -p escrow --release --target wasm32-unknown-unknown
	@echo "✓ Escrow build complete."

# Build only revenue_distributor contract
build-revenue-distributor:
	@echo "Building revenue_distributor contract..."
	cargo build -p revenue_distributor --release --target wasm32-unknown-unknown
	@echo "✓ RevenueDistributor build complete."

# Verify WASM binaries were created
check-wasm:
	@echo "Checking WASM binaries..."
	@ls -lh target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || echo "No WASM files found. Run 'make build' first."

# ===== Testing =====

# Run all tests locally (requires Rust)
test:
	@echo "Running all tests..."
	cargo test --verbose
	@echo "✓ Tests complete."

# Run all tests in Docker
test-docker:
	@echo "Running tests in Docker..."
	docker-compose exec soroban cargo test --verbose
	@echo "✓ Docker tests complete."

# Test only escrow contract
test-escrow:
	@echo "Testing escrow contract..."
	cargo test -p escrow --verbose
	@echo "✓ Escrow tests complete."

# Test only revenue_distributor contract
test-revenue-distributor:
	@echo "Testing revenue_distributor contract..."
	cargo test -p revenue_distributor --verbose
	@echo "✓ RevenueDistributor tests complete."

# Run tests with output
test-verbose:
	@echo "Running tests with output..."
	cargo test -- --nocapture --test-threads=1

# Run specific test
test-filter:
	@read -p "Enter test name filter: " filter; \
	cargo test $$filter -- --nocapture

# ===== Environment Management =====

# Start Soroban services
soroban-up:
	@echo "Starting Soroban development environment..."
	docker-compose up -d soroban soroban-rpc
	@echo "✓ Soroban RPC available at: http://localhost:8000"
	@echo "✓ Use 'make soroban-shell' to enter the Soroban container"

# Stop Soroban services
soroban-down:
	@echo "Stopping Soroban services..."
	docker-compose down soroban soroban-rpc
	@echo "✓ Services stopped."

# Enter Soroban CLI container
soroban-shell:
	@echo "Entering Soroban CLI container..."
	docker-compose exec soroban bash

# Check Soroban version
soroban-version:
	@docker-compose exec soroban soroban --version

# ===== Cleanup =====

# Remove build artifacts
clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	@echo "✓ Cleaned."

# Remove Docker volumes and images
clean-docker:
	@echo "Cleaning Docker resources..."
	docker-compose down -v soroban soroban-rpc
	docker image rm stellar/soroban-preview:latest 2>/dev/null || true
	@echo "✓ Docker resources cleaned."

# Full clean
clean-all: clean clean-docker
	@echo "✓ Full cleanup complete."

# ===== Deployment =====

# Deploy contracts to local network
deploy-local:
	@echo "Deploying contracts to local Soroban network..."
	@if [ ! -f target/wasm32-unknown-unknown/release/escrow.wasm ]; then \
		echo "WASM file not found. Building first..."; \
		$(MAKE) build; \
	fi
	docker-compose exec soroban soroban contract deploy \
		--wasm ./target/wasm32-unknown-unknown/release/escrow.wasm \
		--network standalone
	@echo "✓ Contract deployed."

# ===== Development Utilities =====

# Watch for changes and rebuild
watch:
	@echo "Watching for changes..."
	cargo watch -x "build --target wasm32-unknown-unknown" -x test

# Format code
fmt:
	@echo "Formatting Rust code..."
	cargo fmt
	@echo "✓ Code formatted."

# Lint code
lint:
	@echo "Linting Rust code..."
	cargo clippy --target wasm32-unknown-unknown -- -D warnings
	@echo "✓ Linting complete."

# Check code (no build)
check:
	@echo "Checking Rust code..."
	cargo check --target wasm32-unknown-unknown
	@echo "✓ Code check complete."

# ===== Documentation =====

# Generate documentation
docs:
	@echo "Generating documentation..."
	cargo doc --target wasm32-unknown-unknown --no-deps --open
	@echo "✓ Documentation generated."

# View Soroban development guide
docs-soroban:
	@echo "Opening Soroban development guide..."
	@command -v open >/dev/null 2>&1 && open SOROBAN_DEVELOPMENT.md || \
	  command -v xdg-open >/dev/null 2>&1 && xdg-open SOROBAN_DEVELOPMENT.md || \
	  cat SOROBAN_DEVELOPMENT.md

# ===== Shortcuts =====

# Build and test
build-test: build test
	@echo "✓ Build and test complete."

# Build, test, and check
all: check build test
	@echo "✓ All checks complete."

# Development setup
dev-setup: soroban-up build test
	@echo "✓ Development environment ready!"

# Quick build and test (Docker)
quick: build-docker test-docker
	@echo "✓ Quick build and test complete."

# Print current workspace members
members:
	@echo "Workspace members:"
	@cargo metadata --format-version 1 | jq '.workspace_members[]' 2>/dev/null || \
	  echo "Install jq to see workspace members, or edit Cargo.toml"

# Show contract sizes
sizes:
	@echo "Contract WASM sizes:"
	@du -h target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null | sort -h || \
	  echo "No WASM files. Run 'make build' first."

# ===== Continuous Integration =====

# CI build (for CI/CD pipelines)
ci-build:
	@echo "CI Build..."
	cargo build --release --target wasm32-unknown-unknown --verbose

# CI test (for CI/CD pipelines)
ci-test:
	@echo "CI Tests..."
	cargo test --verbose --all

# Full CI validation
ci: ci-build ci-test lint check
	@echo "✓ CI validation complete."

.PHONY: help build build-docker build-escrow check-wasm test test-docker test-escrow test-verbose test-filter soroban-up soroban-down soroban-shell soroban-version clean clean-docker clean-all deploy-local watch fmt lint check docs docs-soroban members sizes ci-build ci-test ci build-test all dev-setup quick
