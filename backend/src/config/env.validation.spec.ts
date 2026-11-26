import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ConfigValidationError,
  envValidationSchema,
  REQUIRED_ENV_VARS,
  validateEnvironment,
} from './env.validation';

describe('validateEnvironment', () => {
  const required = {
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/agric_onchain',
    JWT_SECRET: 'test-secret',
    STELLAR_PLATFORM_SECRET:
      'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    STELLAR_NETWORK: 'testnet',
    DATABASE_PASSWORD: 'password',
  };

  it('accepts all required environment variables', () => {
    expect(() => validateEnvironment({ ...required })).not.toThrow();
  });

  it.each(REQUIRED_ENV_VARS)(
    'throws ConfigValidationError when required env var %s is missing',
    (missingKey) => {
      const env = { ...required } as Record<string, unknown>;
      delete env[missingKey];

      expect(() => validateEnvironment(env)).toThrow(ConfigValidationError);
      expect(() => validateEnvironment(env)).toThrow(missingKey);
    },
  );

  it('lists all missing required variables in a single ConfigValidationError', () => {
    try {
      validateEnvironment({});
      fail('Expected ConfigValidationError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const validationErr = err as ConfigValidationError;
      for (const key of REQUIRED_ENV_VARS) {
        expect(validationErr.message).toContain(key);
        expect(validationErr.invalidKeys).toContain(key);
      }
    }
  });

  it('startup with missing JWT_SECRET via ConfigModule throws ConfigValidationError', async () => {
    const prevEnv = { ...process.env };
    try {
      Object.assign(process.env, required);
      delete process.env.JWT_SECRET;

      await expect(
        Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              ignoreEnvFile: true,
              validationSchema: envValidationSchema,
              validate: validateEnvironment,
            }),
          ],
        }).compile(),
      ).rejects.toThrow(ConfigValidationError);
    } finally {
      process.env = prevEnv;
    }
  });

  it('requires CLAM_SCAN_ENABLED to be true in production', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        CLAM_SCAN_ENABLED: false,
      }),
    ).toThrow(ConfigValidationError);
    expect(
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        CLAM_SCAN_ENABLED: 'true',
      }),
    ).toHaveProperty('CLAM_SCAN_ENABLED', true);
  });

  it('validates pool bounds and configurable monitoring intervals', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        DATABASE_POOL_MIN: '6',
        DATABASE_POOL_MAX: '5',
      }),
    ).toThrow('DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX');

    expect(() =>
      validateEnvironment({
        ...required,
        DATABASE_HEALTH_CHECK_INTERVAL_MS: '0',
      }),
    ).toThrow(ConfigValidationError);

    expect(
      validateEnvironment({
        ...required,
        DATABASE_POOL_MIN: '2',
        DATABASE_POOL_MAX: '5',
        DATABASE_HEALTH_CHECK_INTERVAL_MS: '15000',
      }),
    ).toMatchObject({
      DATABASE_POOL_MIN: 2,
      DATABASE_POOL_MAX: 5,
      DATABASE_HEALTH_CHECK_INTERVAL_MS: 15000,
    });
  });

  it('validates ESCROW_BATCH_SIZE bounds (1..95) and defaults to 95', () => {
    const defaultRes = validateEnvironment({ ...required });
    expect(defaultRes.ESCROW_BATCH_SIZE).toBe(95);

    const validCustom = validateEnvironment({
      ...required,
      ESCROW_BATCH_SIZE: 50,
    });
    expect(validCustom.ESCROW_BATCH_SIZE).toBe(50);

    expect(() =>
      validateEnvironment({
        ...required,
        ESCROW_BATCH_SIZE: 0,
      }),
    ).toThrow();

    expect(() =>
      validateEnvironment({
        ...required,
        ESCROW_BATCH_SIZE: 96,
      }),
    ).toThrow();
  });
});
