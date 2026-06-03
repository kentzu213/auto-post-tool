/**
 * Shared configuration redaction helper.
 *
 * Pure, dependency-free functions that keep Secret_Values out of logs. They
 * preserve config key NAMES but mask the VALUE of any key matching a secret
 * pattern, so startup/config logging can show what is configured without ever
 * printing a secret.
 *
 * Requirements: 6.3 (exclude secret values from startup config logs),
 * 12.7 (exclude secrets and decrypted platform tokens from structured logs).
 */

/** Placeholder substituted for any masked Secret_Value. */
export const REDACTED = '***REDACTED***';

/**
 * Case-insensitive substrings that mark a config key as holding a Secret_Value.
 * Covers `*_SECRET` (incl. OAuth client secrets), `*_KEY` (encryption / JWT /
 * S3 / API keys), `*_PASSWORD`, `*_TOKEN` (incl. decrypted platform token
 * fields) and `DATABASE_URL` (which embeds a password).
 */
const SECRET_KEY_PATTERNS = ['SECRET', 'KEY', 'PASSWORD', 'TOKEN', 'DATABASE_URL'] as const;

/**
 * Returns true when a config key name indicates its value is a Secret_Value.
 */
export function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return SECRET_KEY_PATTERNS.some((pattern) => upper.includes(pattern));
}

/**
 * Returns the value for a config key, masked when the key is a secret.
 * Non-secret keys pass through unchanged. Empty/undefined values are returned
 * as-is (there is nothing to hide).
 */
export function redactValue(key: string, value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return value;
  }
  return isSecretKey(key) ? REDACTED : value;
}

/**
 * Returns a shallow copy of a config object with every secret value masked and
 * all key names preserved.
 */
export function redactConfig(
  obj: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const key of Object.keys(obj)) {
    result[key] = redactValue(key, obj[key]);
  }
  return result;
}
