import * as Joi from 'joi';

export const validateEnvironment = (config: Record<string, unknown>) => {
  const schema = Joi.object({
    JWT_SECRET: Joi.string().required().trim(),
    STELLAR_NETWORK: Joi.string().required().trim(),
    DATABASE_PASSWORD: Joi.string().required().trim(),
  }).unknown(true); // Allow other env vars that aren't validated

  const { error, value } = schema.validate(config, { abortEarly: false });

  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  return value;
};
