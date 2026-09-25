# Agri-Fi Testing Strategy & Execution Guide

This document defines the comprehensive testing strategy for the Agri-Fi platform across all architectural layers: Backend (NestJS + TypeORM), Frontend (Next.js 14 + React Testing Library), Blockchain (Soroban Rust smart contracts), and Infrastructure (k6 load and soak testing).

---

## Table of Contents

1. [Strategy Matrix: Test Types, Locations & Commands](#strategy-matrix-test-types-locations--commands)
2. [Conventions & Directory Standards](#conventions--directory-standards)
   - [Naming Conventions](#naming-conventions)
   - [Fixtures, Factories, and Mocks](#fixtures-factories-and-mocks)
3. [Domain Testing Deep Dive](#domain-testing-deep-dive)
   - [Backend Unit & Integration Tests (Jest + TypeORM)](#backend-unit--integration-tests-jest--typeorm)
   - [Backend E2E Tests (Docker Compose Environment)](#backend-e2e-tests-docker-compose-environment)
   - [Property-Based Tests (fast-check)](#property-based-tests-fast-check)
   - [Smart Contract Tests (Rust Cargo Test)](#smart-contract-tests-rust-cargo-test)
   - [Frontend Unit & Component Tests (Jest / RTL)](#frontend-unit--component-tests-jest--rtl)
   - [Performance, Load & Soak Tests (k6)](#performance-load--soak-tests-k6)
4. [Coverage Expectations & Quality Gates](#coverage-expectations--quality-gates)
5. [CI-Gated Pipelines & Enforcement Rules](#ci-gated-pipelines--enforcement-rules)
6. [Summary of Convenience Commands](#summary-of-convenience-commands)

---

## 1. Strategy Matrix: Test Types, Locations & Commands

| Test Type | Scope & Focus | Primary Location | Execution Command | Required Infrastructure |
|---|---|---|---|---|
| **Backend Unit Tests** | Isolated business logic in services, controllers, DTO validators, interceptors | `backend/src/**/*.spec.ts` | `npm test` (in `backend`) or `npm run test:backend` | None (in-memory mocks) |
| **Backend E2E Tests** | Full request/response API flows, TypeORM persistence, PostgreSQL RLS, RabbitMQ queues | `backend/test/*.e2e-spec.ts` | `npm run test:e2e` (in `backend`) or `npm run test:e2e` | Docker Compose (PostgreSQL 16/17, RabbitMQ) |
| **Property-Based Tests** | Invariant properties, mathematical boundaries, randomized stress inputs | `backend/test/*.property.spec.ts` & `backend/src/**/*.spec.ts` | `npm run test:property` (in `backend`) | `fast-check` (min 100 runs) |
| **Smart Contract Tests** | Soroban contract state, auth simulation, cross-contract calls, event emissions | `blockchain/contracts/*/src/test.rs` | `cargo test` (in `blockchain`) or `make test` | Rust toolchain (`wasm32-unknown-unknown`) |
| **Frontend Component Tests** | React component rendering, user interactions, form validation, state hooks | `frontend/src/**/*.test.tsx` & `*.spec.ts` | `pnpm test` (in `frontend`) or `npm run test:frontend` | Node.js, Jest DOM |
| **Load & Soak Tests** | System throughput under concurrency, memory leak detection, bottleneck profiling | `tests/load/k6-performance.js` | `k6 run tests/load/k6-performance.js` or `npm run test:load` | k6 CLI, running staging/local cluster |

---

## 2. Conventions & Directory Standards

### Naming Conventions

To keep tests easily discoverable and ensure Jest runners pick up the intended files:

- **Unit & Feature Tests**: `*.spec.ts` (backend) / `*.test.tsx` or `*.spec.ts` (frontend), co-located in the same directory as the source file (e.g. `auth.service.ts` $\rightarrow$ `auth.service.spec.ts`).
- **End-to-End Tests**: `*.e2e-spec.ts`, located strictly in `backend/test/` (e.g. `backend/test/sep24-withdrawal.e2e-spec.ts`).
- **Property Tests**: `*.property.spec.ts` (e.g. `backend/test/escrow.property.spec.ts`).
- **Smart Contract Tests**: `test.rs` or `tests/*.rs` within each contract's crate `src/` directory.
- **Load / Performance Tests**: `tests/load/*.js` (k6 test scripts).

### Fixtures, Factories, and Mocks

- **Mocks Directory**: Place reusable third-party service mocks in `backend/test/mocks/`:
  - `backend/test/mocks/horizon-mock.ts`: Mock Stellar Horizon RPC responses for balance lookups and account sequences.
- **Test Fixtures**: Common test payloads, seeded crypto keypairs, and KYC test documents belong in `backend/test/fixtures/`.
- **Database Seeding**: Test fixtures should use factories or deterministic seed scripts (`backend/scripts/seed.ts`). Never depend on external network states in unit tests.

---

## 3. Domain Testing Deep Dive

### Backend Unit & Integration Tests (Jest + TypeORM)

Backend tests run on Jest with NestJS testing utilities (`Test.createTestingModule`):

```bash
# Run all backend unit tests
cd backend && npm test

# Run a single test file
npm test -- src/auth/auth.service.spec.ts

# Run in watch mode during development
npm run test:watch
```

**Key Guidelines**:
- Mock database repositories using `@InjectRepository(Entity)` tokens with Jest mock functions (`mockRepo = { findOne: jest.fn(), save: jest.fn() }`).
- For database integration tests that verify raw SQL or TypeORM query builders, use the PostgreSQL test container configured with the test database URL (`DATABASE_URL=postgres://agri:agri@localhost:5432/agri_test`).

### Backend E2E Tests (Docker Compose Environment)

End-to-end tests boot the full NestJS application module and communicate over HTTP via Supertest:

```bash
# Start background dependencies
docker compose up -d postgres rabbitmq

# Run all E2E specs
cd backend && npm run test:e2e

# Run a specific E2E flow (e.g., SEP-24 withdrawal)
npm run test:e2e -- --testPathPattern="sep24-withdrawal"
```

**Key Areas Covered by E2E**:
- Authentication & JWT token issuance (`auth-token.e2e-spec.ts`).
- Escrow queue processing and dead-letter queue behavior (`escrow.consumer-dlq.e2e-spec.ts`).
- Concurrency and pessimistic lock verification (`concurrency.e2e-spec.ts`).
- Stellar account merging and claimable balances (`stellar-account-merge.e2e-spec.ts`).

### Property-Based Tests (fast-check)

Property tests verify mathematical and business invariants across thousands of randomized inputs:

```bash
cd backend && npm run test:property
```

**Requirements**:
1. Must use `fast-check`.
2. Must specify at least 100 runs per property (`fc.assert(..., { numRuns: 100 })`).
3. Must explicitly reference the design property in a comment:
   ```typescript
   // Feature: agric-onchain-finance, Property 1: token_count = floor(total_value / 100)
   it('should always maintain invariant token_count', () => {
     fc.assert(
       fc.property(fc.nat(1_000_000), (amount) => {
         expect(calculateTokens(amount)).toEqual(Math.floor(amount / 100));
       }),
       { numRuns: 100 },
     );
   });
   ```

### Smart Contract Tests (Rust Cargo Test)

Soroban smart contracts are tested locally using the embedded Soroban environment without requiring a live node:

```bash
# Test all contracts in workspace
cd blockchain && make test

# Test a single contract
cargo test -p escrow

# Test with uncaptured logging output
cargo test -p escrow -- --nocapture
```

Soroban tests simulate:
- Mocking address signatures via `env.mock_all_auths()`.
- Multi-party escrow settlements and token transfers via `env.register_stellar_asset_contract()`.
- Reverting conditions and error code assertions.

### Frontend Unit & Component Tests (Jest / RTL)

Frontend tests evaluate React components, user events, and forms:

```bash
cd frontend && pnpm test
```

Components that fetch from API endpoints should mock network calls using Jest or MSW (Mock Service Worker).

### Performance, Load & Soak Tests (k6)

Load testing scripts reside in `tests/load/k6-performance.js`:

```bash
# Run performance test
k6 run tests/load/k6-performance.js

# Or via root convenience command
npm run test:load
```

Tests benchmark:
- Throughput (RPS) on marketplace browsing endpoints.
- Database connection pool behavior under 500 concurrent virtual users (VUs).
- Memory leak detection during prolonged soak runs.

---

## 4. Coverage Expectations & Quality Gates

Agri-Fi enforces automated code quality and coverage thresholds:

- **SonarQube Quality Gate**:
  - Minimum **80%** test coverage on new backend code.
  - Zero critical or blocker security vulnerabilities.
  - Zero unresolved merge conflict markers.
- **Coverage Report Generation**:
  ```bash
  cd backend && npm run test:cov
  ```
  Generates `coverage/lcov.info` and `coverage/coverage-summary.json`.

---

## 5. CI-Gated Pipelines & Enforcement Rules

Every Pull Request must pass the following CI pipelines before merging into `develop` or `main`:

| Workflow File | Trigger Path | Gated Checks |
|---|---|---|
| `.github/workflows/ci.yml` | `**` | • Backend lint (`--max-warnings=0`)<br>• ER diagram freshness (`doc:diagram`)<br>• Database migrations (`migration:run`)<br>• Backend unit tests (`npm test`)<br>• Frontend lint & tests (`pnpm test`) |
| `.github/workflows/backend-ci.yml` | `backend/**` | • Matrix Node.js (20, 22) & PostgreSQL (16, 17)<br>• Lockfile verification (`npm ci --dry-run`)<br>• Backend build (`nest build`)<br>• Coverage check & SonarQube quality gate<br>• E2E SEP-24 test suite |
| `.github/workflows/frontend-ci.yml` | `frontend/**` | • Frontend lint & type check<br>• Component tests (`pnpm test`)<br>• Next.js production build (`pnpm build`) |
| `.github/workflows/soroban-ci.yml` | `blockchain/**` | • Rust toolchain & wasm32 compilation (`cargo build`)<br>• Smart contract tests (`cargo test`)<br>• TypeScript client binding generation |
| `.github/workflows/security.yml` | `**` | • Secret leaks detection (TruffleHog / Gitleaks)<br>• Dependency vulnerability audit (`npm audit` / Trivy) |

---

## 6. Summary of Convenience Commands

Run these commands from the repository root:

```bash
# Run all unit tests (backend + frontend)
npm test

# Run backend unit tests only
npm run test:backend

# Run frontend tests only
npm run test:frontend

# Run blockchain contract tests
npm run test:contracts

# Run backend E2E tests (requires docker compose)
npm run test:e2e

# Run backend property tests
npm run test:property

# Run k6 load performance test
npm run test:load

# Run full cross-stack test suite
npm run test:all
```
