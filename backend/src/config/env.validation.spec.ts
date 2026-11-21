import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const required = {
    JWT_SECRET: 'test-secret',
    STELLAR_NETWORK: 'testnet',
    DATABASE_PASSWORD: 'password',
  };

  it('requires CLAM_SCAN_ENABLED to be true in production', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        CLAM_SCAN_ENABLED: false,
      }),
    ).toThrow();
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
    ).toThrow();

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
