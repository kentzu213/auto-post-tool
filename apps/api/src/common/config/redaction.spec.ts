import {
  REDACTED,
  isSecretKey,
  redactValue,
  redactConfig,
} from './redaction';

/**
 * Task 1.7 — unit tests for the shared config redaction helper.
 *
 * The helper preserves config key NAMES but masks the VALUE of any key whose
 * name matches a secret pattern, so startup/config logging can show what is
 * configured without ever printing a secret.
 *
 * Requirements: 6.3 (exclude secret values from startup config logs),
 * 12.7 (exclude secrets and decrypted platform tokens from structured logs).
 *
 * The implementation matches case-insensitive SUBSTRINGS: SECRET, KEY,
 * PASSWORD, TOKEN, DATABASE_URL. Assertions below are aligned to that actual
 * behavior (e.g. REDIS_HOST is NOT secret, but a key containing "KEY" is).
 */
describe('config redaction helper', () => {
  describe('isSecretKey', () => {
    // Keys whose NAME marks the value as a secret (substring match, any case).
    const secretKeys = [
      'JWT_SECRET',
      'GOOGLE_CLIENT_SECRET',
      'FACEBOOK_APP_SECRET',
      'ENCRYPTION_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'S3_ACCESS_KEY_ID',
      'OPENAI_API_KEY',
      'ADMIN_PASSWORD',
      'REDIS_PASSWORD',
      'REFRESH_TOKEN',
      'PLATFORM_ACCESS_TOKEN',
      'DATABASE_URL',
      // case-insensitivity
      'jwt_secret',
      'database_url',
    ];

    it.each(secretKeys)('treats %s as a secret key', (key) => {
      expect(isSecretKey(key)).toBe(true);
    });

    // Keys whose NAME does not match any secret substring.
    const nonSecretKeys = [
      'PORT',
      'NODE_ENV',
      'REDIS_HOST',
      'REDIS_PORT',
      'LOG_LEVEL',
      'API_BASE_URL',
      'SENTRY_DSN',
    ];

    it.each(nonSecretKeys)('treats %s as a non-secret key', (key) => {
      expect(isSecretKey(key)).toBe(false);
    });
  });

  describe('redactValue', () => {
    it('masks the value of a secret key to the REDACTED placeholder', () => {
      expect(redactValue('JWT_SECRET', 'super-secret-value')).toBe(REDACTED);
      expect(redactValue('DATABASE_URL', 'postgres://u:p@host/db')).toBe(
        REDACTED,
      );
    });

    it('passes a non-secret value through unchanged', () => {
      expect(redactValue('PORT', '3000')).toBe('3000');
      expect(redactValue('NODE_ENV', 'production')).toBe('production');
      expect(redactValue('REDIS_HOST', 'localhost')).toBe('localhost');
    });

    it('returns empty and undefined values as-is (nothing to hide)', () => {
      expect(redactValue('JWT_SECRET', '')).toBe('');
      expect(redactValue('JWT_SECRET', undefined)).toBeUndefined();
      expect(redactValue('PORT', undefined)).toBeUndefined();
    });
  });

  describe('redactConfig', () => {
    it('masks every secret value while preserving all key names and non-secret values', () => {
      const input = {
        PORT: '3000',
        NODE_ENV: 'production',
        REDIS_HOST: 'localhost',
        JWT_SECRET: 'super-secret-value',
        GOOGLE_CLIENT_SECRET: 'g-secret',
        ENCRYPTION_KEY: 'a'.repeat(64),
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        REFRESH_TOKEN: 'refresh-abc',
      };

      const result = redactConfig(input);

      // All key names are preserved.
      expect(Object.keys(result).sort()).toEqual(Object.keys(input).sort());

      // Non-secret values pass through unchanged.
      expect(result.PORT).toBe('3000');
      expect(result.NODE_ENV).toBe('production');
      expect(result.REDIS_HOST).toBe('localhost');

      // Secret values are masked.
      expect(result.JWT_SECRET).toBe(REDACTED);
      expect(result.GOOGLE_CLIENT_SECRET).toBe(REDACTED);
      expect(result.ENCRYPTION_KEY).toBe(REDACTED);
      expect(result.DATABASE_URL).toBe(REDACTED);
      expect(result.REFRESH_TOKEN).toBe(REDACTED);

      // No raw secret leaks into the redacted object.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('super-secret-value');
      expect(serialized).not.toContain('g-secret');
      expect(serialized).not.toContain('refresh-abc');
      expect(serialized).not.toContain('user:pass');
    });

    it('returns a new object and does not mutate the input', () => {
      const input = { JWT_SECRET: 'super-secret-value', PORT: '3000' };

      const result = redactConfig(input);

      expect(result).not.toBe(input);
      expect(input.JWT_SECRET).toBe('super-secret-value');
      expect(result.JWT_SECRET).toBe(REDACTED);
    });

    it('preserves empty/undefined values for secret keys', () => {
      const input: Record<string, string | undefined> = {
        JWT_SECRET: '',
        REFRESH_TOKEN: undefined,
        PORT: '3000',
      };

      const result = redactConfig(input);

      expect(result.JWT_SECRET).toBe('');
      expect(result.REFRESH_TOKEN).toBeUndefined();
      expect(result.PORT).toBe('3000');
    });
  });
});
