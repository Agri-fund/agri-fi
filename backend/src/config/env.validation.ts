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
    SENSOR_TEMP_MIN: Joi.number().default(-5),
    SENSOR_TEMP_MAX: Joi.number().default(45),
    SENSOR_HUMIDITY_MIN: Joi.number().default(20),
    SENSOR_HUMIDITY_MAX: Joi.number().default(85),
    SENSOR_CO2_MIN: Joi.number().default(350),
    SENSOR_CO2_MAX: Joi.number().default(2500),
    SENSOR_VIBRATION_MIN: Joi.number().default(0),
    SENSOR_VIBRATION_MAX: Joi.number().default(10),
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

  const sensorRanges: Array<[string, string]> = [
    ['SENSOR_TEMP_MIN', 'SENSOR_TEMP_MAX'],
    ['SENSOR_HUMIDITY_MIN', 'SENSOR_HUMIDITY_MAX'],
    ['SENSOR_CO2_MIN', 'SENSOR_CO2_MAX'],
    ['SENSOR_VIBRATION_MIN', 'SENSOR_VIBRATION_MAX'],
  ];

  for (const [minKey, maxKey] of sensorRanges) {
    if (value[minKey] > value[maxKey]) {
      throw new Error(
        `Config validation error: ${minKey} must not exceed ${maxKey}`,
      );
    }
  }

  return value;
};