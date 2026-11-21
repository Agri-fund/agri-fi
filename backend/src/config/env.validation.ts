import * as Joi from 'joi';

export const validateEnvironment = (config: Record<string, unknown>) => {
  const schema = Joi.object({
    JWT_SECRET: Joi.string().required().trim(),
    STELLAR_NETWORK: Joi.string().required().trim(),
    DATABASE_PASSWORD: Joi.string().required().trim(),
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
    CLAM_SCAN_ENABLED: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().truthy('true').valid(true).required(),
      otherwise: Joi.boolean().default(true),
    }),
    ESCROW_BATCH_SIZE: Joi.number().integer().min(1).max(95).default(95),
  }).unknown(true); // Allow other env vars that aren't validated

  const { error, value } = schema.validate(config, { abortEarly: false });

  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  if (
    value.DATABASE_POOL_MIN !== undefined &&
    value.DATABASE_POOL_MAX !== undefined &&
    value.DATABASE_POOL_MIN > value.DATABASE_POOL_MAX
  ) {
    throw new Error(
      'Config validation error: DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX',
    );
  }

  return value;
};
