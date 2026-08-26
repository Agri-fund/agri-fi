/**
 * Jest configuration for End-to-End (E2E) tests
 *
 * This configuration is designed to run integration and E2E tests
 * that test the full application stack, including database, messaging, and external services.
 *
 * Usage:
 *   npm run test:e2e           # Run all E2E tests
 *   npm run test:e2e -- --watch # Run in watch mode
 *
 * Environment Setup:
 *   - Ensure DATABASE_URL, RABBITMQ_URL, and other required env vars are set
 *   - Copy .env.example to .env.test and configure for your test environment
 *   - Database should be fresh/empty before running E2E tests
 *
 * Test Organization:
 *   - Legacy E2E tests: backend/test/*.e2e-spec.ts
 *   - New E2E tests: backend/tests/e2e/*.test.ts
 *
 * Best Practices:
 *   - Use beforeAll() to set up test data and initialize modules
 *   - Use afterAll() to clean up resources and close connections
 *   - Use beforeEach() to reset state between test cases
 *   - Ensure tests are isolated and don't depend on execution order
 */

module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  // Include both legacy E2E tests and new E2E test structure
  roots: ['<rootDir>/test', '<rootDir>/tests/e2e'],
  // Match both legacy and new naming conventions
  testMatch: ['**/*.e2e-spec.ts', '**/*.test.ts'],
  // Exclude unit tests (those should be run with jest.config.js)
  testPathIgnorePatterns: ['.*\\.spec\\.ts$'],
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  // E2E tests are integration tests, so they're kept separate
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: '../coverage/e2e',
  // Setup file to run before test suite
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
  // Module name mapper for path aliases
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
