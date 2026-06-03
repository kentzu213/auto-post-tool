/**
 * Worker Config_Loader — fail-fast runtime configuration validation.
 *
 * Mirrors the worker Required_Config_Variable set and validation shape defined
 * in `apps/api/src/common/config/config-loader.ts` (REQUIRED_BY_ROLE.worker +
 * `loadWorkerConfig`). It lives in the worker project because the worker
 * tsconfig pins `rootDir` to `./src` and cannot import files from the api
 * package; the required set is intentionally identical.
 *
 * Validates DATABASE_URL, REDIS_HOST, REDIS_PORT, ENCRYPTION_KEY, the S3_*
 * credentials, and the OAuth client secrets — NOT JWT secrets or CORS (those
 * are API-only). On any missing/empty variable, or a malformed ENCRYPTION_KEY,
 * it logs the offending NAME(s) only (never the values) and terminates the
 * process with a non-zero exit code.
 *
 * Requirements: 6.1 (read config from the environment at runtime),
 * 6.2 (terminate startup non-zero, record which variable was missing/empty),
 * 6.4 (secrets go only to server-side services). Implements Property 4.
 */

/** Required_Config_Variable names for the Worker_Service role. */
const REQUIRED_WORKER_VARS: readonly string[] = [
  'DATABASE_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'ENCRYPTION_KEY',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_NAME',
  'FACEBOOK_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'TIKTOK_CLIENT_SECRET',
];

/** ENCRYPTION_KEY must be exactly 64 hex chars = 32 bytes (mirrors CryptoService). */
const ENCRYPTION_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/** Validated, typed configuration for Worker_Service. Secrets held in memory only. */
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
 * Load and validate configuration for the Worker_Service role. Fails fast
 * (names-only logging + `process.exit(1)`) on missing/invalid config.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const errors: string[] = [];

  const missing = REQUIRED_WORKER_VARS.filter((name) => isAbsentOrEmpty(env[name]));
  if (missing.length > 0) {
    errors.push(`Missing or empty Required_Config_Variable(s): ${missing.join(', ')}`);
  }

  // Format check: only meaningful when present — absence is reported above.
  // Never include the value in the message (name only).
  const encryptionKey = env.ENCRYPTION_KEY;
  if (encryptionKey !== undefined && encryptionKey.trim() !== '' && !ENCRYPTION_KEY_HEX.test(encryptionKey)) {
    errors.push('Invalid Required_Config_Variable: ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)');
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`[Config] ${message}`);
    }
    process.exit(1);
  }

  return {
    databaseUrl: env.DATABASE_URL as string,
    redis: {
      host: env.REDIS_HOST as string,
      port: Number(env.REDIS_PORT),
    },
    encryptionKey: env.ENCRYPTION_KEY as string,
    s3: {
      endpoint: env.S3_ENDPOINT as string,
      accessKey: env.S3_ACCESS_KEY as string,
      secretKey: env.S3_SECRET_KEY as string,
      bucketName: env.S3_BUCKET_NAME as string,
    },
    oauth: {
      facebookClientSecret: env.FACEBOOK_CLIENT_SECRET as string,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET as string,
      tiktokClientSecret: env.TIKTOK_CLIENT_SECRET as string,
    },
  };
}
