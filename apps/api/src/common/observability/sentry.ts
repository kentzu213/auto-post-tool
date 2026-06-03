/**
 * Sentry error-sink initialization for API_Service.
 *
 * GUIDING PRINCIPLE — degrade gracefully: Sentry is initialized ONLY when
 * `SENTRY_DSN` is set. With no DSN this is a complete no-op (`initSentry`
 * returns false, `captureError` does nothing), so the app boots and behaves
 * exactly as it does today in dev with no external error sink configured.
 *
 * Requirements: 12.2 (record unhandled errors in an error-monitoring
 * destination).
 */
import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialize Sentry if `SENTRY_DSN` is configured. Safe to call once at
 * bootstrap. Returns true when Sentry was initialized, false when it stayed a
 * no-op (no DSN). Never throws — a misconfigured sink must not crash startup.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || dsn.trim() === '') {
    return false;
  }
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      // Conservative default; traces are handled by OpenTelemetry separately.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    });
    initialized = true;
  } catch {
    // A bad DSN / transport must never take the process down.
    initialized = false;
  }
  return initialized;
}

/** True when Sentry was successfully initialized (a DSN was provided). */
export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Capture an error to Sentry when enabled; a no-op otherwise. Never throws.
 */
export function captureError(error: unknown): void {
  if (!initialized) {
    return;
  }
  try {
    Sentry.captureException(error);
  } catch {
    // Swallow — error reporting must never mask or replace the original error.
  }
}
