export default () => ({
  app: {
    env: process.env['NODE_ENV'] as string,
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    name: process.env['APP_NAME'] ?? 'Mubryx API',
    prefix: process.env['API_PREFIX'] ?? 'api/v1',
    isDevelopment: process.env['NODE_ENV'] === 'development',
    isProduction: process.env['NODE_ENV'] === 'production',
    isTest: process.env['NODE_ENV'] === 'test',
  },
  database: {
    url: process.env['DATABASE_URL'] as string,
  },
  redis: {
    url: process.env['REDIS_URL'] as string,
  },
  jwt: {
    accessSecret: process.env['JWT_ACCESS_SECRET'] as string,
    refreshSecret: process.env['JWT_REFRESH_SECRET'] as string,
    accessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '30d',
  },
  security: {
    bcryptRounds: parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10),
    corsOrigins: (process.env['CORS_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  },
  rateLimit: {
    ttl: parseInt(process.env['RATE_LIMIT_TTL'] ?? '60000', 10),
    max: parseInt(process.env['RATE_LIMIT_MAX'] ?? '100', 10),
  },
  storage: {
    provider: process.env['STORAGE_PROVIDER'] ?? 'mock',
    wasabi: {
      endpoint: process.env['WASABI_ENDPOINT'],
      region: process.env['WASABI_REGION'],
      accessKey: process.env['WASABI_ACCESS_KEY'],
      secretKey: process.env['WASABI_SECRET_KEY'],
      bucket: process.env['WASABI_BUCKET'],
    },
  },
  sms: {
    provider: process.env['SMS_PROVIDER'] ?? 'mock',
  },
  urls: {
    customerApp: process.env['CUSTOMER_APP_URL'],
    technicianApp: process.env['TECHNICIAN_APP_URL'],
    adminApp: process.env['ADMIN_APP_URL'],
  },
});
