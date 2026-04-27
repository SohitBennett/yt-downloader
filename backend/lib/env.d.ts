// Type declarations for env.js -- parsed and validated process.env.

import type { ZodType } from 'zod';

export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  FRONTEND_URL?: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  S3_BUCKET?: string;
  S3_REGION: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: number;
  TURNSTILE_SECRET_KEY?: string;
  API_KEYS?: string;
}

/** Zod schema for raw env input (string-typed, before coercion). */
export const envSchema: ZodType<Env>;

/** Parses an arbitrary env object (defaults to process.env), exits on failure. */
export function parseEnv(rawEnv?: NodeJS.ProcessEnv): Env;

/** The validated, typed env -- this is what server.js imports. */
export const env: Env;

declare const _default: {
  env: Env;
  envSchema: typeof envSchema;
  parseEnv: typeof parseEnv;
};

export default _default;
export = _default;
