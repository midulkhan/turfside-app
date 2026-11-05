import { z } from 'zod';

/**
 * All configuration comes from environment variables (set them in cPanel →
 * Setup Node.js App → Environment variables). Nothing secret is in the repo.
 * The app starts even when optional services are missing, and /health reports
 * exactly what is not configured yet.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('production'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_URL: z.string().url().default('https://api.turfsides.com'),
  APP_SCHEME: z.string().default('turfsides'),
  CORS_ORIGINS: z.string().default('https://turfsides.com,https://www.turfsides.com'),
  TRUST_PROXY: bool.default(true),

  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  DB_SSL: bool.default(true),

  JWT_SECRET: z.string().min(32).optional(),
  PASS_SECRET: z.string().min(32).optional(),
  OTP_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(24).optional(),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),

  BKASH_MODE: z.enum(['off', 'simulate', 'sandbox', 'live']).default('off'),
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  BKASH_USERNAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),

  // Public values (safe for the app) used for Supabase Realtime slot updates.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),

  // Cloudflare R2 (S3-compatible) for user photos. Secrets live only in the server environment.
  R2_ENDPOINT: z.string().url().optional(), // https://<account-id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(), // public base for reads: https://pub-xxxx.r2.dev or https://cdn.turfsides.com

  // Sign-in / sign-up / code requests per IP per minute. Keep the default in production; tests raise it.
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),

  SERVICE_FEE_POISHA: z.coerce.number().int().min(0).default(0),
  HOLD_MINUTES: z.coerce.number().int().min(2).max(30).default(5),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(180).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print which variable is wrong (never its value) and stop.
  console.error('Invalid environment configuration:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';

if (isProd && config.BKASH_MODE === 'simulate') {
  console.error('BKASH_MODE=simulate is not allowed when NODE_ENV=production.');
  process.exit(1);
}

/** What is missing, for /health and startup logs. */
export function missingConfig() {
  const missing: string[] = [];
  if (!config.DATABASE_URL) missing.push('DATABASE_URL');
  if (!config.JWT_SECRET) missing.push('JWT_SECRET');
  if (!config.PASS_SECRET) missing.push('PASS_SECRET');
  if (!config.OTP_SECRET) missing.push('OTP_SECRET');
  if (!config.CRON_SECRET) missing.push('CRON_SECRET');
  if (!config.UPSTASH_REDIS_REST_URL) missing.push('UPSTASH_REDIS_REST_URL (optional: using in-memory cache)');
  if (config.SMS_PROVIDER === 'http' && !config.SMS_HTTP_URL) missing.push('SMS_HTTP_URL');
  if ((config.BKASH_MODE === 'sandbox' || config.BKASH_MODE === 'live') && !(config.BKASH_APP_KEY && config.BKASH_APP_SECRET && config.BKASH_USERNAME && config.BKASH_PASSWORD))
    missing.push('BKASH_* credentials');
  const r2 = (['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const).filter((k) => !config[k]);
  if (r2.length) missing.push(`${r2.join(', ')} (photo uploads disabled)`);
  return missing;
}
