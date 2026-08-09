export const RedisKeys = {
  otp: (phone: string) => `mubryx:otp:${phone}`,
  otpAttempts: (phone: string) => `mubryx:otp:attempts:${phone}`,
  otpCooldown: (phone: string) => `mubryx:otp:cooldown:${phone}`,
  session: (sessionId: string) => `mubryx:session:${sessionId}`,
  tokenRevoked: (jti: string) => `mubryx:token:revoked:${jti}`,
  userCache: (userId: string) => `mubryx:user:${userId}`,
  categoryCache: (id: string) => `mubryx:category:${id}`,
  categoriesAll: () => `mubryx:categories:all`,
  serviceCache: (id: string) => `mubryx:service:${id}`,
} as const;

export const RedisTTL = {
  OTP_SECONDS: 300,           // 5 minutes
  OTP_COOLDOWN_SECONDS: 60,   // 1 minute resend cooldown
  OTP_MAX_ATTEMPTS: 5,
  SESSION_SECONDS: 60 * 60 * 24 * 30, // 30 days
  USER_CACHE_SECONDS: 300,
  CATEGORY_CACHE_SECONDS: 3600,
  TOKEN_REVOKED_SECONDS: 60 * 60 * 24, // 1 day (covers access token lifetime)
} as const;
