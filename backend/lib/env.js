// Validates process.env at startup with Zod. Fails fast (exit 1) on bad
// configuration so misconfigurations are caught before the server runs.
//
// Type declarations live in env.d.ts -- the parsed `env` object is fully
// typed for TS consumers.

const { z } = require('zod');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(5001),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),

    FRONTEND_URL: z.string().url().optional(),

    // Redis (optional, used by BullMQ queue)
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),

    // Storage (S3/R2). All-or-nothing: bucket without credentials is invalid.
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    // Sentry (optional)
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),

    // Cloudflare Turnstile CAPTCHA (optional)
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // Comma-separated API keys that bypass rate limits (optional)
    API_KEYS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.S3_BUCKET) {
      if (!env.S3_ACCESS_KEY_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ACCESS_KEY_ID'],
          message: 'S3_ACCESS_KEY_ID is required when S3_BUCKET is set.',
        });
      }
      if (!env.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_SECRET_ACCESS_KEY'],
          message: 'S3_SECRET_ACCESS_KEY is required when S3_BUCKET is set.',
        });
      }
    }
  });

function parseEnv(rawEnv = process.env) {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    /* eslint-disable no-console */
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      console.error(`  - ${path}: ${issue.message}`);
    }
    /* eslint-enable no-console */
    process.exit(1);
  }
  return result.data;
}

const env = parseEnv();

module.exports = { env, envSchema, parseEnv };
