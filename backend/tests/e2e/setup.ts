/**
 * E2E Test Setup File
 *
 * This file is executed before the E2E test suite runs.
 * It handles:
 * - Environment variable loading and validation
 * - Global test utilities setup
 * - Database connection setup (if needed)
 * - Mock service initialization
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * Load environment variables from .env.test file if it exists
 * Falls back to .env if .env.test is not found
 * Falls back to default test values if neither exists
 */
const envTestPath = path.resolve(__dirname, '../../.env.test');
const envPath = path.resolve(__dirname, '../../.env');

try {
  // Try loading .env.test first (recommended for local development)
  dotenv.config({ path: envTestPath, override: true });
} catch {
  try {
    // Fall back to .env
    dotenv.config({ path: envPath, override: true });
  } catch {
    // Use defaults if no .env files found
    console.warn('No .env files found, using default test configuration');
    setupDefaultTestEnv();
  }
}

/**
 * Set up default test environment variables
 * These are minimal values that allow tests to run in isolation
 */
function setupDefaultTestEnv() {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  // Database - use test database
  if (!process.env.DATABASE_HOST) {
    process.env.DATABASE_HOST = 'localhost';
  }
  if (!process.env.DATABASE_PORT) {
    process.env.DATABASE_PORT = '5432';
  }
  if (!process.env.DATABASE_USER) {
    process.env.DATABASE_USER = 'postgres';
  }
  if (!process.env.DATABASE_PASSWORD) {
    process.env.DATABASE_PASSWORD = 'postgres';
  }
  if (!process.env.DATABASE_NAME) {
    process.env.DATABASE_NAME = 'agric_onchain_test';
  }

  // JWT - use test secret (not for production)
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-key-do-not-use-in-production';
  }

  // RabbitMQ - optional for tests, mock if not available
  if (!process.env.RABBITMQ_URL) {
    process.env.RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';
  }

  // Stellar - use testnet
  if (!process.env.STELLAR_NETWORK) {
    process.env.STELLAR_NETWORK = 'testnet';
  }
  if (!process.env.STELLAR_HORIZON_URL) {
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
  }
  if (!process.env.SOROBAN_RPC_URL) {
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
  }

  // Encryption - use test key (generates one if not set in test)
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes in hex (64 chars)
  }

  // Logging
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'error'; // Reduce noise in test output
  }
  if (!process.env.LOG_PRETTY) {
    process.env.LOG_PRETTY = 'false';
  }
}

/**
 * Global test timeout configuration
 */
jest.setTimeout(60000);

/**
 * Suppress console output during tests (optional)
 * Uncomment if test output is too verbose
 */
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

/**
 * Validation: Ensure critical env vars are set
 */
function validateTestEnvironment() {
  const requiredVars = [
    'NODE_ENV',
    'DATABASE_HOST',
    'DATABASE_NAME',
    'JWT_SECRET',
  ];

  const missingVars = requiredVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    console.warn(
      `⚠️  Missing environment variables: ${missingVars.join(', ')}`,
    );
    console.warn(
      'Tests may fail. Copy .env.example to .env.test and configure.',
    );
  }

  // Success
  console.log(
    `✓ E2E test environment initialized (NODE_ENV=${process.env.NODE_ENV})`,
  );
}

// Run validation on module load
validateTestEnvironment();

export {};
