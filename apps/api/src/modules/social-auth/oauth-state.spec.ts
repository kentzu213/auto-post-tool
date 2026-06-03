// Feature: workspace-authorization, Property 8: Connect associates the active workspace
// **Validates: Requirements 8.2**
//
// The connect-association invariant is realized through the signed OAuth `state`:
// the workspace a callback associates an account with is derived ONLY from the
// signed state issued at connect, never from a client value or a default. These
// tests exercise the `oauth-state.ts` sign/verify round-trip that enforces it.
import * as fc from 'fast-check';
import { signOAuthState, verifyOAuthState } from './oauth-state';

describe('oauth-state signed-state round-trip (Property 8)', () => {
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
  const ORIGINAL_OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET;
  const TEST_SECRET = 'test-secret-oauth-state-property-8';

  beforeAll(() => {
    // Make JWT_SECRET the authoritative signing secret used by getStateSecret()
    // (OAUTH_STATE_SECRET takes precedence, so clear it for a deterministic env).
    delete process.env.OAUTH_STATE_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
    if (ORIGINAL_OAUTH_STATE_SECRET === undefined) delete process.env.OAUTH_STATE_SECRET;
    else process.env.OAUTH_STATE_SECRET = ORIGINAL_OAUTH_STATE_SECRET;
  });

  // Smart generator: workspace IDs are ASCII identifiers (cuid/uuid-like). Printable
  // ASCII (incl. space) covers the real input space without straying into lone
  // surrogates, which a JSON+utf8 encode/decode cannot faithfully round-trip and
  // which never occur as a DB-generated workspace id.
  const workspaceIdArb = fc
    .array(
      fc.integer({ min: 0x20, max: 0x7e }).map((code) => String.fromCharCode(code)),
      { minLength: 1, maxLength: 64 },
    )
    .map((chars) => chars.join(''));

  it('round-trips any non-empty workspaceId through sign → verify', () => {
    fc.assert(
      fc.property(workspaceIdArb, (workspaceId) => {
        const result = verifyOAuthState(signOAuthState(workspaceId));
        expect(result).not.toBeNull();
        expect(result?.workspaceId).toBe(workspaceId);
      }),
      { numRuns: 200 },
    );
  });

  it('never verifies a tampered/forged/truncated state to the workspace', () => {
    fc.assert(
      fc.property(workspaceIdArb, (workspaceId) => {
        const state = signOAuthState(workspaceId);
        const [payloadB64, signature] = state.split('.');

        // Tampered signature (flip the last char → guaranteed different signature).
        const flippedSig =
          signature.slice(0, -1) + (signature.slice(-1) === 'A' ? 'B' : 'A');
        expect(verifyOAuthState(`${payloadB64}.${flippedSig}`)).toBeNull();

        // Truncated signature (length mismatch → rejected).
        expect(verifyOAuthState(`${payloadB64}.${signature.slice(0, -1)}`)).toBeNull();

        // Tampered payload (flip last char → signature no longer matches).
        const flippedPayload =
          payloadB64.slice(0, -1) + (payloadB64.slice(-1) === 'A' ? 'B' : 'A');
        expect(verifyOAuthState(`${flippedPayload}.${signature}`)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('rejects raw, unsigned, empty, and malformed states', () => {
    // The exact fallback removed in task 20.1: a raw, non-signed value must be
    // rejected and must NOT be trusted as a workspace id.
    expect(verifyOAuthState('default_workspace_id')).toBeNull();
    // Empty / malformed (no '.' separator) values are rejected.
    expect(verifyOAuthState('')).toBeNull();
    expect(verifyOAuthState('no-dot-payload-only')).toBeNull();
    expect(verifyOAuthState('too.many.parts')).toBeNull();
    expect(verifyOAuthState('.')).toBeNull();
  });

  it('states are not cross-verifiable under a different secret (HMAC binds the workspace)', () => {
    const workspaceId = 'ws_secret_binding';
    const state = signOAuthState(workspaceId);
    // Sanity: verifies under the secret it was signed with.
    expect(verifyOAuthState(state)?.workspaceId).toBe(workspaceId);

    // Change the signing secret: a state signed with one secret must not verify
    // under another — proving the workspace is bound by the HMAC, not the payload.
    process.env.JWT_SECRET = 'a-completely-different-secret-value';
    try {
      expect(verifyOAuthState(state)).toBeNull();
    } finally {
      process.env.JWT_SECRET = TEST_SECRET;
    }
  });
});
