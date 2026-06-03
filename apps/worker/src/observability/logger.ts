/**
 * Worker structured JSON logging (pino).
 *
 * Adds a pino JSON logger used to emit one machine-parseable line per job
 * outcome (jobId / queue / outcome / durationMs), alongside the existing emoji
 * console logger which is left untouched for human-readable progress lines.
 *
 * Lives in the worker project because its tsconfig pins `rootDir` to `./src`
 * and cannot import the api package's redaction helper; the secret patterns and
 * REDACTED placeholder are intentionally mirrored here.
 *
 * Requirements: 12.1 (structured JSON job-outcome logs), 12.7 (exclude secrets /
 * decrypted platform tokens from logs). Implements Property 15.
 */
import pino from 'pino';

/** Placeholder substituted for any masked Secret_Value (mirrors api redaction). */
export const REDACTED = '***REDACTED***';

/**
 * Single-level wildcard paths covering secret-bearing fields that might appear
 * on a logged object, so tokens/credentials never reach the log sink.
 */
const REDACT_PATHS: string[] = [
  '*.authorization',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.encryptionKey',
  'accessToken',
  'refreshToken',
  'token',
  'password',
  'secret',
];

/** Shared pino instance for the worker. Level overridable via LOG_LEVEL. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'worker' },
  redact: { paths: REDACT_PATHS, censor: REDACTED },
});

/** Outcome of a processed job, recorded on the structured job-outcome log. */
export type JobOutcome = 'completed' | 'retrying' | 'dead_letter' | 'failed';

/**
 * Emit a single structured JSON line describing a job outcome. `durationMs` is
 * optional (not all outcomes have a measured duration). Never throws.
 */
export function logJobOutcome(fields: {
  jobId: string | undefined;
  queue: string;
  outcome: JobOutcome;
  durationMs?: number;
  scheduleId?: string;
  attemptsMade?: number;
  maxAttempts?: number;
  reason?: string;
}): void {
  try {
    log.info(fields, `job ${fields.outcome}`);
  } catch {
    // Logging must never break the worker flow.
  }
}
