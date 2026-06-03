/**
 * Sentry error sink for Worker_Service (Req 12.2).
 *
 * Initializes `@sentry/node` ONLY when SENTRY_DSN is set; otherwise every
 * capture call is a cheap no-op so the worker boots without a DSN. Mirrors the
 * api Sentry helper (the worker project cannot import api source).
 */
import * as Sentry from '@sentry/node';

let enabled = false;

/** Initialize Sentry if SENTRY_DSN is present. Returns true when enabled. */
export function initSentry(): boolean {
  if (enabled) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_COMMIT_SHA,
    tracesSampleRate: 0,
  });
  enabled = true;
  return true;
}

/** Capture an exception to Sentry when enabled; no-op otherwise. Never throws. */
export function captureException(err: unknown): void {
  if (!enabled) return;
  try {
    Sentry.captureException(err);
  } catch {
    // Never let the error sink break the caller.
  }
}
