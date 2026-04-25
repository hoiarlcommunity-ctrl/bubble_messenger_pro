const path = require('path');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  appName: process.env.APP_NAME || 'Bubble Messenger Pro',
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: numberEnv('PORT', 3000),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || 'postgres://bubble:bubble_password@localhost:5432/bubble_messenger',
  redisUrl: process.env.REDIS_URL || '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || '30d',
  cookieSecure: String(process.env.COOKIE_SECURE || 'false') === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),
  maxUploadMb: numberEnv('MAX_UPLOAD_MB', 80),
  maxVoiceSeconds: numberEnv('MAX_VOICE_SECONDS', 300),
  maxVideoSeconds: numberEnv('MAX_VIDEO_SECONDS', 90),
  rateLimitWindowMs: numberEnv('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: numberEnv('RATE_LIMIT_MAX', 240),
  authRateLimitMax: numberEnv('AUTH_RATE_LIMIT_MAX', 20),
  demoUser: String(process.env.DEMO_USER || 'false') === 'true',
  demoUsername: process.env.DEMO_USERNAME || 'demo',
  demoPassword: process.env.DEMO_PASSWORD || 'demo123',
  demoDisplayName: process.env.DEMO_DISPLAY_NAME || 'Demo User',
  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME || '',
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || '',
  initialAdminDisplayName: process.env.INITIAL_ADMIN_DISPLAY_NAME || 'Administrator',

  // Account security
  registrationOpen: String(process.env.REGISTRATION_OPEN || 'true') === 'true',
  requireEmailVerification: String(process.env.REQUIRE_EMAIL_VERIFICATION || 'true') === 'true',
  emailTokenTtlMinutes: numberEnv('EMAIL_TOKEN_TTL_MINUTES', 24 * 60),
  passwordResetTtlMinutes: numberEnv('PASSWORD_RESET_TTL_MINUTES', 60),
  hcaptchaSecret: process.env.HCAPTCHA_SECRET || '',
  hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY || '',

  // Email delivery. If SMTP_HOST is empty, messages are saved to DEV_MAIL_DIR.
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: numberEnv('SMTP_PORT', 587),
  smtpSecure: String(process.env.SMTP_SECURE || 'false') === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  mailFrom: process.env.MAIL_FROM || 'Bubble Messenger <no-reply@localhost>',
  devMailDir: process.env.DEV_MAIL_DIR || path.join(__dirname, '..', 'data', 'dev-mails'),

  // Media storage: local or s3. S3 settings work with MinIO too.
  storageDriver: process.env.STORAGE_DRIVER || 's3',
  s3Endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  s3Region: process.env.S3_REGION || 'us-east-1',
  s3Bucket: process.env.S3_BUCKET || 'bubble-media',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || '',
  s3ForcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  s3Prefix: process.env.S3_PREFIX || 'uploads',

  // WebRTC ICE/TURN config for calls.
  stunUrls: (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(v => v.trim()).filter(Boolean),
  turnUrls: (process.env.WEBRTC_TURN_URLS || '').split(',').map(v => v.trim()).filter(Boolean),
  turnUsername: process.env.TURN_USERNAME || '',
  turnCredential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || ''
};

module.exports = config;
