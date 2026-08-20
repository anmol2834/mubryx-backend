import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().default(3000),
  APP_NAME: Joi.string().default('Mubryx API'),
  API_PREFIX: Joi.string().default('api/v1'),

  DATABASE_URL: Joi.string().uri().required(),

  REDIS_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  BCRYPT_ROUNDS: Joi.number().min(10).max(14).default(12),

  CORS_ORIGINS: Joi.string().required(),

  RATE_LIMIT_TTL: Joi.number().default(60000),
  RATE_LIMIT_MAX: Joi.number().default(100),

  STORAGE_PROVIDER: Joi.string().valid('wasabi', 'mock').default('mock'),
  WASABI_ENDPOINT: Joi.string().when('STORAGE_PROVIDER', {
    is: 'wasabi',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  WASABI_REGION: Joi.string().when('STORAGE_PROVIDER', {
    is: 'wasabi',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  WASABI_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'wasabi',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  WASABI_SECRET_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'wasabi',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  WASABI_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 'wasabi',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  SMS_PROVIDER: Joi.string().valid('mock', 'msg91', 'twilio', 'shreesms', 'stpl', 'smartping', '2factor').default('mock'),

  FIREBASE_SERVICE_ACCOUNT_KEY: Joi.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().optional(),
  FIREBASE_PROJECT_ID: Joi.string().optional().default('mubryx-alliance'),
  FIREBASE_CLIENT_EMAIL: Joi.string().optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().optional(),

  CUSTOMER_APP_URL: Joi.string().optional(),
  TECHNICIAN_APP_URL: Joi.string().optional(),
  ADMIN_APP_URL: Joi.string().optional(),
});
