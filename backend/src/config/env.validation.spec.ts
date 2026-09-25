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
});
