# Test Environment Setup Guide

This guide explains how to set up your local test environment for the agri-fi backend.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Test Environment

Copy the test environment template:
```bash
cp backend/.env.test.example backend/.env.test
```

### 3. Set Up Test Database

Create a PostgreSQL database for testing:
```bash
psql -U postgres -c "CREATE DATABASE agric_onchain_test;"
```

Or using Docker:
```bash
docker run --name postgres-test \
  -e POSTGRES_DB=agric_onchain_test \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15
```

### 4. Run Tests

**Unit Tests:**
```bash
npm test                 # Run all unit tests
npm run test:watch      # Run in watch mode
npm run test:cov        # Generate coverage report
```

**E2E Tests:**
```bash
npm run test:e2e         # Run all E2E tests
npm run test:e2e -- --watch  # Run in watch mode
```

## Test Configuration

### Jest Configuration Structure

- **jest.config.js** - Unit and component tests
  - Runs: `src/**/*.spec.ts` (excludes E2E tests)
  - Coverage thresholds: 45% global (stricter for auth module)
  - Best for: Feature-level testing

- **jest.e2e.config.js** - Integration and E2E tests
  - Runs: `test/**/*.e2e-spec.ts` + `tests/e2e/**/*.test.ts`
  - 60-second timeout (longer for DB operations)
  - Best for: Full workflow testing, database integration

### Environment Variables

#### Default Values (auto-loaded)
If `.env.test` is not found, the test setup uses safe defaults:
- Database: `localhost:5432/agric_onchain_test`
- JWT Secret: Test key (non-production)
- Stellar: Testnet
- Log Level: `error` (reduces noise)

#### Recommended Local Setup

Create `.env.test` with your local configuration:

```bash
# Database - use test database
DATABASE_NAME=agric_onchain_test
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Stellar - use testnet (default)
STELLAR_NETWORK=testnet

# Logging - reduce noise
LOG_LEVEL=error
NODE_ENV=test

# Other settings - optional
KYC_AUTO_APPROVE=true
```

## Troubleshooting

### Tests Fail: "Cannot find module"
**Solution:** Ensure TypeScript is compiled
```bash
npm run build
```

### Database Connection Error
**Solution:** Verify PostgreSQL is running and accessible
```bash
psql -U postgres -h localhost -c "SELECT 1"
```

### RabbitMQ Connection Error
**Solution:** For tests that don't need RabbitMQ, it's optional. If needed:
```bash
docker run -d --name rabbitmq -p 5672:5672 rabbitmq:3
```

### Tests Timeout
**Solution:** Increase timeout in jest.e2e.config.js or use:
```bash
npm run test:e2e -- --testTimeout=120000
```

### Coverage Threshold Not Met
**Solution:** Check which files are below threshold:
```bash
npm run test:cov
# Review coverage report in ./coverage/index.html
```

## Best Practices

### 1. Clean Setup and Teardown
```typescript
describe('Feature', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Setup once
    app = await createTestingModule();
  });

  afterAll(async () => {
    // Clean up
    await app.close();
  });

  beforeEach(() => {
    // Reset state before each test
  });
});
```

### 2. Isolate External Services
Mock external services (Stellar, RabbitMQ) for unit tests:
```typescript
const mockStellarService = {
  getTransaction: jest.fn().mockResolvedValue(txHash),
};

const module = Test.createTestingModule({
  providers: [
    { provide: StellarService, useValue: mockStellarService },
  ],
});
```

### 3. Use Test Database
- Run migrations before E2E tests
- Use transactions to rollback changes
- Clean up test data after each test

### 4. Organized Test Structure
```
backend/
├── src/
│   ├── auth/
│   │   ├── auth.service.spec.ts      (unit test)
│   │   ├── auth.controller.spec.ts   (unit test)
│   │   └── ...
├── test/
│   └── auth.e2e-spec.ts              (integration test)
└── tests/
    └── e2e/
        └── auth.test.ts              (new E2E test)
```

## Continuous Integration

For CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run unit tests
  run: npm test -- --coverage --ci

- name: Run E2E tests
  run: npm run test:e2e -- --ci
  env:
    DATABASE_HOST: postgres
    DATABASE_NAME: agric_onchain_test
```

## See Also

- [Jest Documentation](https://jestjs.io)
- [NestJS Testing Guide](https://docs.nestjs.com/fundamentals/testing)
- Backend [README.md](../README.md)
