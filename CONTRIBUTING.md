# Contributing to Agric-onchain Finance Platform

Thanks for your interest in contributing. This guide covers everything you need to get the project running locally and submit quality changes.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Prerequisites](#prerequisites)
3. [Local Setup](#local-setup)
4. [Running the Project](#running-the-project)
5. [Environment Variables](#environment-variables)
6. [Database Migrations](#database-migrations)
7. [Testing](#testing)
8. [Code Style](#code-style)
9. [Branching and Commits](#branching-and-commits)
10. [Submitting a Pull Request](#submitting-a-pull-request)
11. [Architecture Notes](#architecture-notes)

---

## Project Structure

```
.
├── backend/          # NestJS API (TypeScript)
│   ├── src/
│   │   ├── auth/         # Registration, login, KYC, JWT
│   │   ├── stellar/      # Stellar SDK wrapper (escrow, tokens, memos)
│   │   ├── queue/        # RabbitMQ client (async jobs)
│   │   └── database/     # TypeORM config + migrations
│   └── package.json
├── frontend/         # Next.js 14 app (TypeScript + Tailwind)
│   └── src/app/
├── docker-compose.yml  # PostgreSQL + RabbitMQ
└── .kiro/specs/        # Feature specs (requirements, design, tasks)
```

---

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker + Docker Compose
- A [Stellar testnet](https://laboratory.stellar.org/) account (for Stellar-related work)

---

## Local Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/Agri-fund/agri-fi.git
cd agric-onchain

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL on port `5432` and RabbitMQ on port `5672` (management UI at `http://localhost:15672`, credentials: `guest/guest`).

### 3. Configure environment

```bash
cp backend/.env.example backend/.env
```

Fill in the required values — see [Environment Variables](#environment-variables) below.

### 4. Run migrations

```bash
cd backend
npm run migration:run
```

---

## Running the Project

```bash
# Backend (port 3001)
cd backend && npm run start:dev

# Frontend (port 3000)
cd frontend && npm run dev
```

The API will be available at `http://localhost:3001` and the frontend at `http://localhost:3000`.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and update the values:

| Variable | Description | Required |
|---|---|---|
| `DATABASE_HOST` | PostgreSQL host | yes |
| `DATABASE_PORT` | PostgreSQL port (default: 5432) | yes |
| `DATABASE_USER` | DB username | yes |
| `DATABASE_PASSWORD` | DB password | yes |
| `DATABASE_NAME` | DB name (`agric_onchain`) | yes |
| `JWT_SECRET` | Secret for signing JWTs | yes |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `7d`) | yes |
| `RABBITMQ_URL` | RabbitMQ connection URL | yes |
| `STELLAR_NETWORK` | `testnet` or `mainnet` | yes |
| `STELLAR_HORIZON_URL` | Horizon API URL | yes |
| `STELLAR_PLATFORM_SECRET` | Platform Stellar secret key | yes |
| `STELLAR_PLATFORM_PUBLIC` | Platform Stellar public key | yes |
| `ENCRYPTION_KEY` | AES-256 key for escrow secrets at rest | yes |
| `IPFS_GATEWAY` | IPFS/web3.storage API URL | optional |
| `IPFS_TOKEN` | web3.storage API token | optional |
| `AWS_REGION` | S3 region (fallback storage) | optional |
| `AWS_ACCESS_KEY_ID` | S3 access key | optional |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key | optional |
| `AWS_S3_BUCKET` | S3 bucket name | optional |

For Stellar work, generate a testnet keypair at https://laboratory.stellar.org and fund it via [Friendbot](https://friendbot.stellar.org).

### Frontend env vars

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the backend the frontend talks to (e.g. `http://localhost:3001` for local dev). Baked into the client bundle at `next build` time. | yes for `next build` |

The marketplace pages (`src/app/marketplace/**`) are rendered on demand (`export const dynamic = 'force-dynamic'`) so `pnpm run build` does not require a reachable backend. If you add new server components that fetch from the API, either mark them `force-dynamic` or wrap the fetch in `try/catch` so the build can continue on transient failures.

---

## Database Migrations

Migrations live in `backend/src/database/migrations/`. TypeORM is configured with `synchronize: false` — always use migrations for schema changes.

```bash
# Run all pending migrations
npm run migration:run

# Revert the last migration
npm run migration:revert

# Generate a new migration (after editing entities)
npm run typeorm migration:generate -- -d src/database/data-source.ts src/database/migrations/YourMigrationName
```

Migration file naming convention: `{timestamp}-{PascalCaseName}.ts`

### Index Review Guidelines

**Important**: New query patterns require index review to prevent performance degradation as tables grow.

- **Before adding new queries**: Consider if they need indexes, especially for `WHERE`, `JOIN`, and `ORDER BY` clauses
- **Composite indexes**: Create for multi-column filters (e.g., `(trade_deal_id, status)` for investment availability queries)
- **Foreign key indexes**: Ensure all foreign key columns have indexes for efficient joins
- **Pessimistic locks**: Queries under `pessimistic_write` locks must use indexes to avoid full table scans
- **Test with EXPLAIN ANALYZE**: Verify queries use index scans, not sequential scans

When in doubt, add the index — PostgreSQL query planner will choose the most efficient execution path.

---

## Testing

The backend uses **Jest** for unit/integration tests and **fast-check** for property-based tests.

```bash
# Run all tests
cd backend && npm test

# Run a specific test file
npm test src/auth/auth.service.spec.ts

# Run with coverage
npm run test:cov
```

### Guidelines

- Unit tests go in `*.spec.ts` files co-located with the source file they test.
- Property-based tests use `fast-check` and must run a minimum of 100 iterations.
- Each property test must include a comment referencing its spec property:
  ```ts
  // Feature: agric-onchain-finance, Property 1: token_count = floor(total_value / 100)
  ```
- Do not use mocks to make tests pass — tests must validate real logic.
- All tests must pass before a PR can be merged.

---

## Code Style

- TypeScript strict mode is enabled — no implicit `any`.
- NestJS conventions: one module per feature, services handle business logic, controllers handle HTTP.
- DTOs use `class-validator` decorators for input validation.
- Entities use TypeORM decorators; no raw SQL outside migrations.
- Keep services free of HTTP concerns (`HttpException` is fine, but no `Request`/`Response` imports in services).
- Stellar interactions go through `StellarService` only — never call the SDK directly from other services.

### Logging Conventions

The project uses structured logging with `nestjs-pino` for better observability and debugging:

- **Use PinoLogger**: Inject `PinoLogger` instead of NestJS `Logger` in all services
- **Set context**: Always call `this.logger.setContext(ServiceName.name)` in constructors
- **Structured data**: Use objects for log data, strings for messages:
  ```ts
  // Good
  this.logger.info({ userId, dealId, amount }, 'Investment created successfully');
  
  // Bad
  this.logger.info(`Investment created for user ${userId} deal ${dealId} amount ${amount}`);
  ```
- **Log levels**:
  - `info`: Normal operations (deal created, payment processed)
  - `warn`: Recoverable issues (retry attempts, validation warnings)
  - `error`: Failures that require attention (Stellar errors, database failures)
- **Correlation IDs**: All logs automatically include correlation IDs for request tracing
- **No console.log**: Never use `console.log` in service files — always use the injected logger

Run the linter before committing:

```bash
cd backend && npm run lint
```

---

## Branching and Commits

- Branch from `main` for all changes.
- Branch naming: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  ```
  feat(auth): add KYC document submission endpoint
  fix(stellar): handle 404 on getTransactionStatus
  chore(deps): upgrade stellar-sdk to 12.3.0
  ```
- Keep commits focused — one logical change per commit.

---

## Submitting a Pull Request

1. Make sure all tests pass: `npm test`
2. Make sure the linter is clean: `npm run lint`
3. Open a PR against `main` with a clear description of what changed and why.
4. Reference any related spec task (e.g. `Implements task 4.1 from .kiro/specs/agric-onchain-finance/tasks.md`).
5. PRs require at least one review before merging.

---

## Architecture Notes

- **PostgreSQL** is the source of truth for application state.
- **Stellar** is the source of truth for payment finality — always verify on-chain before updating DB status.
- **RabbitMQ** handles all async Stellar jobs (asset issuance, escrow release). Never submit Stellar transactions synchronously in a request handler.
- **Escrow secret keys** are stored encrypted at rest using AES-256. Never log or expose them.
- All Stellar interactions target **testnet** during development. Switch to mainnet by setting `STELLAR_NETWORK=mainnet` and updating `STELLAR_HORIZON_URL`.
- The `StellarService` is a global NestJS provider — inject it wherever blockchain operations are needed.
