import * as Joi from 'joi';

export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STELLAR_PLATFORM_SECRET',
  'RABBITMQ_URL',
  'REDIS_URL',
  'ENCRYPTION_KEY',
] as const;

export class ConfigValidationError extends Error {
  public readonly invalidKeys: string[];

  constructor(message: string, invalidKeys: string[] = []) {
    super(message);
    this.name = 'ConfigValidationError';
    this.invalidKeys = invalidKeys;
  }
}

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required().trim(),
  JWT_SECRET: Joi.string().required().trim(),
  STELLAR_PLATFORM_SECRET: Joi.string().required().trim(),
  RABBITMQ_URL: Joi.string().required().trim(),
  REDIS_URL: Joi.string().required().trim(),
  ENCRYPTION_KEY: Joi.string().required().trim(),
  STELLAR_NETWORK: Joi.string().default('testnet').trim(),
  DATABASE_PASSWORD: Joi.string().optional().allow('').trim(),
  DATABASE_POOL_MIN: Joi.number().integer().min(0),
  DATABASE_POOL_MAX: Joi.number().integer().positive(),
  DATABASE_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().positive(),
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: Joi.number().integer().positive(),
  DATABASE_HEALTH_CHECK_INTERVAL_MS: Joi.number().integer().positive(),
  DATABASE_CONNECTION_LEAK_THRESHOLD_MS: Joi.number().integer().positive(),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number().integer().positive(),
  RABBITMQ_VHOST: Joi.string()
    .trim()
    .pattern(/^\//)
    .default('/production')
    .messages({
      'string.pattern.base': 'RABBITMQ_VHOST must start with "/"',
    }),
    PQC_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
    PQC_KEM_ALGORITHM: Joi.string()
      .trim()
      .valid('ML-KEM-768', 'ML-KEM-1024')
      .default('ML-KEM-768'),
    PQC_SIGNATURE_ALGORITHM: Joi.string()
      .trim()
      .valid('ML-DSA-65', 'ML-DSA-87')
      .default('ML-DSA-65'),
    PQC_HYBRID_MODE: Joi.boolean().truthy('true').falsy('false').default(true),
    PQC_FALLBACK_TO_CLASSICAL: Joi.boolean()
      .truthy('true')
      .falsy('false')
      .default(false),
    PQC_KEY_ROTATION_DAYS: Joi.number().integer().positive().default(90),
    PQC_KEY_STORE_PATH: Joi.string().trim().when('PQC_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    ESCROW_BATCH_SIZE: Joi.number().integer().min(1).max(95).default(95),
    SENSOR_TEMP_MIN: Joi.number().default(-5),
    SENSOR_TEMP_MAX: Joi.number().default(45),
    SENSOR_HUMIDITY_MIN: Joi.number().default(20),
    SENSOR_HUMIDITY_MAX: Joi.number().default(85),
    SENSOR_CO2_MIN: Joi.number().default(350),
    SENSOR_CO2_MAX: Joi.number().default(2500),
    SENSOR_VIBRATION_MIN: Joi.number().default(0),
    SENSOR_VIBRATION_MAX: Joi.number().default(10),

  }).unknown(true); // Allow other env vars that aren't validated

  const errors: string[] = [];
  const invalidKeys = new Set<string>();

  if (error) {
    for (const detail of error.details) {
      errors.push(detail.message);
      const key = detail.path?.[0];
      if (typeof key === 'string' && key.length > 0) {
        invalidKeys.add(key);
      }
    }
  }

  const candidate = value ?? config;

  if (
    candidate.DATABASE_POOL_MIN !== undefined &&
    candidate.DATABASE_POOL_MAX !== undefined &&
    Number(candidate.DATABASE_POOL_MIN) > Number(candidate.DATABASE_POOL_MAX)
  ) {
    errors.push('DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX');
    invalidKeys.add('DATABASE_POOL_MIN');
    invalidKeys.add('DATABASE_POOL_MAX');
  }

  const sensorRanges: Array<[string, string]> = [
    ['SENSOR_TEMP_MIN', 'SENSOR_TEMP_MAX'],
    ['SENSOR_HUMIDITY_MIN', 'SENSOR_HUMIDITY_MAX'],
    ['SENSOR_CO2_MIN', 'SENSOR_CO2_MAX'],
    ['SENSOR_VIBRATION_MIN', 'SENSOR_VIBRATION_MAX'],
  ];

  for (const [minKey, maxKey] of sensorRanges) {
    if (
      candidate[minKey] !== undefined &&
      candidate[maxKey] !== undefined &&
      Number(candidate[minKey]) > Number(candidate[maxKey])
    ) {
      errors.push(`${minKey} must not exceed ${maxKey}`);
      invalidKeys.add(minKey);
      invalidKeys.add(maxKey);
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(
      `Config validation error: ${errors.join('; ')}`,
      Array.from(invalidKeys),
    );
  }

  return value;
};