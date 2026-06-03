/**
 * HTTP Basic auth gate for the Bull Board queue dashboard (`/admin/queues`).
 *
 * Req 15.4: administrative interfaces (the queue dashboard) MUST require
 * authentication so they are not publicly accessible in production.
 *
 * DESIGN CHOICE — HTTP Basic auth via env credentials, gated to degrade
 * gracefully in dev:
 *   - When BOTH `BULL_BOARD_USER` and `BULL_BOARD_PASSWORD` are set, every
 *     request to the dashboard must present matching Basic credentials or gets
 *     401 with a `WWW-Authenticate` challenge.
 *   - When the credentials are NOT set:
 *       * in production (`NODE_ENV === 'production'`) the dashboard is DENIED
 *         (503) — it is never exposed unauthenticated in prod, even by
 *         misconfiguration (fail closed);
 *       * outside production it is left OPEN for local use, so dev without
 *         creds keeps working exactly as today.
 *
 * Credentials are compared with a constant-time check to avoid leaking length/
 * content via timing. This is wired as the BullBoard `middleware` option in
 * `app.module.ts`, so it runs BEFORE the dashboard router handles the request.
 */
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison to keep timing roughly constant, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Parse a `Basic base64(user:pass)` Authorization header into credentials. */
function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) {
    return null;
  }
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

/**
 * Express middleware enforcing the policy described above. Exported as a plain
 * function so it can be passed to `BullBoardModule.forRoot({ middleware })`.
 */
export function bullBoardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = process.env.BULL_BOARD_USER;
  const expectedPass = process.env.BULL_BOARD_PASSWORD;
  const credentialsConfigured = Boolean(expectedUser) && Boolean(expectedPass);

  if (!credentialsConfigured) {
    if (process.env.NODE_ENV === 'production') {
      // Fail closed: never serve the dashboard unauthenticated in production.
      res
        .status(503)
        .json({ statusCode: 503, message: 'Queue dashboard is disabled: admin credentials are not configured.' });
      return;
    }
    // Dev convenience: no creds set → open locally.
    next();
    return;
  }

  const provided = parseBasicAuth(req.headers.authorization);
  const ok =
    provided !== null &&
    safeEqual(provided.user, expectedUser as string) &&
    safeEqual(provided.pass, expectedPass as string);

  if (!ok) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board", charset="UTF-8"');
    res.status(401).json({ statusCode: 401, message: 'Authentication required.' });
    return;
  }

  next();
}
