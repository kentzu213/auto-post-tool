/**
 * Structured JSON logging config for API_Service (nestjs-pino).
 *
 * Wires pino as the Nest logger so every HTTP request is emitted as a single
 * JSON line containing method, path (url), status code, response time
 * (duration) and a request id (req.id) — and so all `Logger` calls in the app
 * become structured JSON too. The existing `console.log` emoji lines in
 * `main.ts` are untouched (they are plain stdout, not routed through Nest's
 * logger).
 *
 * Redaction (Req 12.7): pino's native `redact` masks Secret_Values so tokens /
 * credentials never reach a log sink. We cover the request/response headers
 * that carry credentials (Authorization, Cookie, Set-Cookie, API keys) plus
 * common secret-bearing object fields via single-level wildcards. The censor
 * reuses the shared REDACTED placeholder.
 *
 * Requirements: 12.1 (structured JSON request logs), 12.7 (exclude secrets /
 * decrypted platform tokens from logs). Implements Property 15.
 */
import type { Params } from 'nestjs-pino';
import { REDACTED } from '../config/redaction';

/**
 * pino `redact` paths. Header paths catch the credentials carried on HTTP
 * request/response logging; the `*.<field>` single-level wildcards catch
 * secret-bearing fields on any object that gets logged (mergingObject).
 */
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.encryptionKey',
  '*.jwt',
];

/**
 * Build the nestjs-pino params. `autoLogging` emits one JSON line per HTTP
 * request (method/url/status/responseTime/req.id). Level is overridable via
 * LOG_LEVEL and defaults to `info`.
 */
export function buildLoggerParams(): Params {
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      autoLogging: true,
      redact: { paths: LOG_REDACT_PATHS, censor: REDACTED },
    },
  };
}
