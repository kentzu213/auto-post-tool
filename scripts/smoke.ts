/**
 * Post-deploy smoke test — Task 11.1 (Req 10.1, Property 2).
 *
 * Exercises the critical path against a deployed API and exits NON-ZERO on the
 * first failure so CI/CD can gate a release on it. Property 2 ("the running
 * artifact is the expected one") is enforced by the optional EXPECTED_SHA check
 * against GET /version.commit.
 *
 * Steps:
 *   1. GET  /health/live   -> expect 200          (liveness)
 *   2. GET  /health/ready  -> expect 200          (dependencies reachable)
 *   3. GET  /version       -> if EXPECTED_SHA set, assert commit === EXPECTED_SHA
 *   4. POST /auth/login    -> expect 200, capture accessToken   (SKIPPED if no creds)
 *   5. POST /posts         -> expect 2xx, create a SCHEDULED (future) post
 *
 * Steps 4–5 are SKIPPED (not failed) when SMOKE_EMAIL / SMOKE_PASSWORD are not
 * provided, so the script is usable in environments without a seeded user.
 * A *full* smoke run requires those credentials.
 *
 * Zero extra dependencies: uses Node 18+ global `fetch` and `AbortSignal.timeout`.
 *
 * How to run (Node >= 22.18 / 23+ strips TS types natively):
 *   node scripts/smoke.ts
 *   pnpm smoke                                   # root package.json script
 *   SMOKE_API_URL=https://api.example.com EXPECTED_SHA=$GITHUB_SHA \
 *     SMOKE_EMAIL=smoke@example.com SMOKE_PASSWORD=*** node scripts/smoke.ts
 *   node scripts/smoke.ts https://api.example.com https://app.example.com
 *
 * Environment variables:
 *   SMOKE_API_URL    Base API URL            (default http://localhost:3001; arg #1 overrides)
 *   SMOKE_WEB_URL    Base web URL (optional) (arg #2 overrides; basic reachability check only)
 *   EXPECTED_SHA     Expected /version.commit (optional; enables Property 2 assertion)
 *   SMOKE_EMAIL      Login email for authed steps (optional)
 *   SMOKE_PASSWORD   Login password for authed steps (optional)
 *   SMOKE_WORKSPACE_ID  Override workspaceId for the post (optional; defaults to login's defaultWorkspace.id)
 *   SMOKE_TIMEOUT_MS Per-request timeout in ms (default 5000)
 */

// ---- Config from args + env -------------------------------------------------

const argv = process.argv.slice(2);

const API_URL = stripTrailingSlash(argv[0] || process.env.SMOKE_API_URL || 'http://localhost:3001');
const WEB_URL = argv[1] || process.env.SMOKE_WEB_URL || '';
const EXPECTED_SHA = process.env.EXPECTED_SHA || '';
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || '';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || '';
const SMOKE_WORKSPACE_ID = process.env.SMOKE_WORKSPACE_ID || '';
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT_MS || '5000', 10);

// ---- Tiny logging + assertion helpers --------------------------------------

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

function log(msg: string): void {
  console.log(`[smoke] ${msg}`);
}

/** Raised on any failed assertion; caught by main() which sets a non-zero exit. */
class SmokeFailure extends Error {}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new SmokeFailure(message);
  }
}

// ---- HTTP with a hard per-request timeout (never hangs CI) ------------------

type HttpResult = { status: number; body: string; json: unknown };

async function request(
  method: string,
  url: string,
  options: { token?: string; jsonBody?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.jsonBody);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload,
      // AbortSignal.timeout rejects the fetch if the server is unreachable or
      // slow, so a down API reports a connection failure instead of hanging.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SmokeFailure(`${method} ${url} — request failed: ${reason}`);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON body is fine; callers that need JSON assert on it explicitly
  }
  return { status: res.status, body: text, json: parsed };
}

// ---- Smoke steps ------------------------------------------------------------

async function checkLiveness(): Promise<void> {
  const r = await request('GET', `${API_URL}/health/live`);
  assert(r.status === 200, `GET /health/live expected 200, got ${r.status}`);
  log(`/health/live OK (200)`);
}

async function checkReadiness(): Promise<void> {
  const r = await request('GET', `${API_URL}/health/ready`);
  assert(
    r.status === 200,
    `GET /health/ready expected 200, got ${r.status} — body: ${r.body}`,
  );
  log(`/health/ready OK (200)`);
}

/** Property 2: the running artifact is the expected one (when EXPECTED_SHA set). */
async function checkVersion(): Promise<void> {
  const r = await request('GET', `${API_URL}/version`);
  assert(r.status === 200, `GET /version expected 200, got ${r.status}`);
  const body = r.json as { commit?: string; buildId?: string } | undefined;
  assert(body !== undefined, `GET /version did not return JSON — body: ${r.body}`);
  const commit = body?.commit ?? 'unknown';
  if (EXPECTED_SHA) {
    assert(
      commit === EXPECTED_SHA,
      `Property 2 violated: /version.commit "${commit}" !== EXPECTED_SHA "${EXPECTED_SHA}"`,
    );
    log(`/version OK — running expected artifact (commit=${commit})`);
  } else {
    log(`/version OK — commit=${commit}, buildId=${body?.buildId ?? 'unknown'} (EXPECTED_SHA not set, skipping Property 2 assertion)`);
  }
}

/** Returns the access token + the workspace id to use for the post step. */
async function login(): Promise<{ token: string; workspaceId: string | undefined }> {
  const r = await request('POST', `${API_URL}/auth/login`, {
    jsonBody: { email: SMOKE_EMAIL, password: SMOKE_PASSWORD },
  });
  assert(
    r.status === 200,
    `POST /auth/login expected 200, got ${r.status} — body: ${r.body}`,
  );
  const body = r.json as
    | { accessToken?: string; defaultWorkspace?: { id?: string } }
    | undefined;
  const token = body?.accessToken;
  assert(typeof token === 'string' && token.length > 0, `POST /auth/login returned no accessToken — body: ${r.body}`);
  log(`/auth/login OK (200) — token acquired`);
  return { token: token as string, workspaceId: body?.defaultWorkspace?.id };
}

async function createScheduledPost(token: string, workspaceId: string): Promise<void> {
  // Future scheduledAt => the post is created in the SCHEDULED state.
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const r = await request('POST', `${API_URL}/posts`, {
    token,
    jsonBody: {
      workspaceId,
      content: `[smoke-test] scheduled post @ ${new Date().toISOString()}`,
      scheduledAt,
    },
  });
  assert(
    r.status >= 200 && r.status < 300,
    `POST /posts expected 2xx, got ${r.status} — body: ${r.body}`,
  );
  log(`/posts OK (${r.status}) — scheduled post created (scheduledAt=${scheduledAt})`);
}

/** Optional: only run when SMOKE_WEB_URL is provided. Reachability only. */
async function checkWeb(): Promise<void> {
  const base = stripTrailingSlash(WEB_URL);
  const r = await request('GET', base || WEB_URL);
  assert(r.status < 500, `GET ${WEB_URL} expected < 500, got ${r.status}`);
  log(`web ${WEB_URL} reachable (${r.status})`);
}

// ---- Runner -----------------------------------------------------------------

async function main(): Promise<void> {
  log(`target API: ${API_URL}`);
  log(`per-request timeout: ${TIMEOUT_MS}ms`);

  // Critical path — always run.
  await checkLiveness();
  await checkReadiness();
  await checkVersion();

  if (WEB_URL) {
    await checkWeb();
  }

  // Authenticated path — requires seeded smoke credentials.
  if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
    log(
      'SKIP authed steps: SMOKE_EMAIL / SMOKE_PASSWORD not set. ' +
        'Full smoke (login + scheduled post) requires these credentials.',
    );
    log('SMOKE PASSED (health/version only)');
    return;
  }

  const { token, workspaceId: loginWorkspaceId } = await login();
  const workspaceId = SMOKE_WORKSPACE_ID || loginWorkspaceId;
  assert(
    typeof workspaceId === 'string' && workspaceId.length > 0,
    'No workspaceId available for /posts (login returned no defaultWorkspace; set SMOKE_WORKSPACE_ID)',
  );
  await createScheduledPost(token, workspaceId as string);

  log('SMOKE PASSED (full critical path)');
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[smoke] FAILED: ${msg}`);
  process.exit(1);
});
