import * as crypto from 'crypto';

/**
 * Signed OAuth `state` helpers (Req 8.2).
 *
 * The OAuth `state` parameter travels from the authenticated `connect` call,
 * out to the social provider, and back to the public `callback/:platform`
 * endpoint (which has no JWT). To let the callback TRUST the workspace without
 * a JWT — and to prevent a caller from forging the workspace — the active
 * `workspaceId` is encoded into a signed token instead of being sent in clear.
 *
 * Format: `base64url(payload) + '.' + base64url(hmacSHA256(payload, secret))`
 * where `payload = JSON.stringify({ workspaceId, nonce, iat })`.
 *
 * The signing secret is read from env (`OAUTH_STATE_SECRET`, falling back to the
 * existing `JWT_SECRET`); it is never hardcoded.
 */

export interface OAuthStatePayload {
  workspaceId: string;
  nonce: string;
  iat: number;
}

/**
 * Resolve the HMAC signing secret from env. Prefers a dedicated
 * `OAUTH_STATE_SECRET`, otherwise reuses the required `JWT_SECRET`.
 */
function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'OAUTH_STATE_SECRET or JWT_SECRET environment variable is required to sign the OAuth state',
    );
  }
  return secret;
}

function computeSignature(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Build a signed OAuth `state` encoding the active workspace.
 * Throws if no signing secret is configured (connect should fail loudly).
 */
export function signOAuthState(workspaceId: string): string {
  const payload: OAuthStatePayload = {
    workspaceId,
    nonce: crypto.randomBytes(16).toString('base64url'),
    iat: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = computeSignature(payloadB64, getStateSecret());
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a signed OAuth `state` and extract its workspace.
 * Returns `null` for any absent/malformed/tampered/unsigned value so the
 * caller can reject the request — never trust a raw, unverified value.
 */
export function verifyOAuthState(
  state: string,
): { workspaceId: string; nonce: string } | null {
  if (!state || typeof state !== 'string') return null;

  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  let expectedSignature: string;
  try {
    expectedSignature = computeSignature(payloadB64, getStateSecret());
  } catch {
    // No signing secret configured — cannot verify, so reject.
    return null;
  }

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as OAuthStatePayload;
    if (!payload || typeof payload.workspaceId !== 'string' || !payload.workspaceId) {
      return null;
    }
    return { workspaceId: payload.workspaceId, nonce: payload.nonce };
  } catch {
    return null;
  }
}
