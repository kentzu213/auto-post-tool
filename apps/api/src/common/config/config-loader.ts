/**
 * Config_Loader — fail-fast runtime configuration validation.
 *
 * Centralizes the startup validation that today only exists in CryptoService
 * (which throws on a missing/invalid ENCRYPTION_KEY). `loadConfig` reads every
 * Required_Config_Variable from the process environment, fails fast (logging
 * only the offending NAMES, never the values) and returns a typed config whose
 * Secret_Values live in memory only.
 *
 * NOTE: This module DEFINES and EXPORTS `loadConfig` (api) and
 * `loadWorkerConfig` (worker). `loadConfig` is wired into
 * `apps/api/src/main.ts` (task 1.4); the worker validates via the same
 * Required_Config_Variable source in `apps/worker/src/index.ts` (task 1.5).
 *
 * Requirements: 6.1 (read config from the environment at runtime),
 * 6.2 (terminate startup non-zero and record which variable was missing/empty),
 * 6.5 (production config kept separate from dev defaults),
 * 6.6 (CORS allowlist / external URLs from config). Implements Property 4.
 */

/**
 * Roles an Application_Service can load config for. `api` is loaded via
 * `loadConfig`; `worker` is loaded via `loadWorkerConfig`. Both share the
 * Required_Config_Variable source in REQUIRED_BY_ROLE and the same fail-fast
 * validation.
 */
export type ConfigRole = 'api' | 'worker';

/**
 * Required_Config_Variable names per role.
 *
 * `api` mirrors the design's required set. `worker` omits the JWT secrets and
 * CORS (which are API-only) and is consumed by `loadWorkerConfig`.
 */
export const REQUIRED_BY_ROLE: Record<ConfigRole, readonly string[]> = {
  api: [
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'ENCRYPTION_KEY',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET_NAME',
    'CORS_ORIGINS',
  ],
  worker: [
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'ENCRYPTION_KEY',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET_NAME',
  ],
};

/** ENCRYPTION_KEY must be exactly 64 hex chars = 32 bytes (mirrors CryptoService). */
const ENCRYPTION_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Validated, typed configuration for API_Service. Secret_Values are held here
 * in memory only; they are never logged.
 */
export interface ApiConfig {
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
  };
  encryptionKey: string;
  jwt: {
    secret: string;
    refreshSecret: string;
  };
  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucketName: string;
  };
  oauth: {
    facebookClientSecret: string;
    googleClientSecret: string;
    tiktokClientSecret: string;
  };
  corsOrigins: string[];
}

/**
 * Validated, typed configuration for Worker_Service. Like ApiConfig but without
 * the API-only JWT secrets and CORS allowlist (the worker never serves HTTP).
 */
export interface WorkerConfig {
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
  };
  encryptionKey: string;
  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucketName: string;
  };
  oauth: {
    facebookClientSecret: string;
    googleClientSecret: string;
    tiktokClientSecret: string;
  };
}

/** A config value counts as absent when undefined or blank (whitespace-only). */
function isAbsentOrEmpty(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Shared fail-fast validation for a given role's Required_Config_Variable set.
 *
 * Logs only the offending variable NAME(s) — never their values — and
 * terminates the process with a non-zero exit code when anything is missing or
 * malformed. Returns normally only when the environment is valid.
 */
function assertRequiredConfig(env: NodeJS.ProcessEnv, role: ConfigRole): void {
  const required = REQUIRED_BY_ROLE[role];
  const errors: string[] = [];

  const missing = required.filter((name) => isAbsentOrEmpty(env[name]));
  if (missing.length > 0) {
    errors.push(`Missing or empty Required_Config_Variable(s): ${missing.join(', ')}`);
  }

  // Format check: only meaningful when present — absence is reported above.
  // Never include the value in the message (name only).
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!isAbsentOrEmpty(encryptionKey) && !ENCRYPTION_KEY_HEX.test(encryptionKey)) {
    errors.push('Invalid Required_Config_Variable: ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)');
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`[Config] ${message}`);
    }
    process.exit(1);
  }
}

/**
 * Load and validate configuration for the API_Service role.
 *
 * On any missing/empty Required_Config_Variable, or an ENCRYPTION_KEY that is
 * not 64 hex characters, this logs the offending variable NAME(s) only and
 * terminates the process with a non-zero exit code. Otherwise it returns the
 * typed ApiConfig.
 */
export function loadConfig(env: NodeJS.ProcessEnv, role: 'api'): ApiConfig {
  assertRequiredConfig(env, role);

  return {
    databaseUrl: env.DATABASE_URL,
    redis: {
      host: env.REDIS_HOST,
      port: Number(env.REDIS_PORT),
    },
    encryptionKey: env.ENCRYPTION_KEY,
    jwt: {
      secret: env.JWT_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
    },
    s3: {
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucketName: env.S3_BUCKET_NAME,
    },
    oauth: {
      facebookClientSecret: env.FACEBOOK_CLIENT_SECRET,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      tiktokClientSecret: env.TIKTOK_CLIENT_SECRET,
    },
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

/**
 * Load and validate configuration for the Worker_Service role.
 *
 * Validates the worker Required set (REQUIRED_BY_ROLE.worker): DATABASE_URL,
 * REDIS_HOST, REDIS_PORT, ENCRYPTION_KEY, the S3_* credentials, and the OAuth
 * client secrets — but NOT JWT secrets or CORS (those are API-only). On any
 * missing/empty variable, or a malformed ENCRYPTION_KEY, it logs the offending
 * NAME(s) only and terminates the process with a non-zero exit code. Otherwise
 * it returns the typed WorkerConfig.
 *
 * Defined as a separate function (rather than widening `loadConfig`'s return
 * type) so the existing api typing is untouched.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  assertRequiredConfig(env, 'worker');

  return {
    databaseUrl: env.DATABASE_URL,
    redis: {
      host: env.REDIS_HOST,
      port: Number(env.REDIS_PORT),
    },
    encryptionKey: env.ENCRYPTION_KEY,
    s3: {
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucketName: env.S3_BUCKET_NAME,
    },
    oauth: {
      facebookClientSecret: env.FACEBOOK_CLIENT_SECRET,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      tiktokClientSecret: env.TIKTOK_CLIENT_SECRET,
    },
  };
}
