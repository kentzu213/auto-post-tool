#!/usr/bin/env bash
#
# scripts/rollback.sh — Rollback Production to a prior Container_Image (Req 10.2, 10.3, 10.4).
#
# WHERE THIS RUNS: the Linux production host that holds the repo checkout +
# docker-compose.prod.yml + the production .env. It is NOT meant to run on the
# Windows dev box. Make it executable once on a POSIX checkout:
#     chmod +x scripts/rollback.sh
#
# WHAT IT DOES, in order:
#   1. Resolve PREV_SHA — the commit SHA to roll back to (Req 10.2):
#        - PRIMARY: the first CLI argument  ($1)   ← recommended, always unambiguous.
#        - FALLBACK: the last *successful* Deploy_Audit_Record for the target env,
#          read from the JSONL audit log written by the deploy workflow (task 12.3)
#          at ${DEPLOY_AUDIT_LOG:-/var/log/autopost/deploys.jsonl}.
#        If neither yields a SHA the script aborts with a clear error.
#   2. Re-deploy api/web/worker at PREV_SHA (Req 10.3): point those three services at
#        ghcr.io/<owner>/autopost-{api,web,worker}:sha-<PREV_SHA> via a generated Compose
#        OVERRIDE file, then `docker compose pull` + `up -d --no-build` for them only.
#        Data services (postgres/redis/minio) and Caddy are left running untouched.
#        NO destructive DB step is run: migrations are forward-only + backward-compatible,
#        so a prior image's schema is a subset of what is already applied (Req 10.4, Req 7.2).
#   3. Wait until the rolled-back artifact is actually serving (Req 10.3): poll
#        GET ${API_HEALTH_URL}/version until .commit == PREV_SHA AND
#        GET ${API_HEALTH_URL}/health/ready returns 200, up to a timeout.
#
# IMAGE NAMING — kept in lock-step with the CI publish job (task 12.1, .github/workflows/ci.yml):
#        ghcr.io/<owner>/autopost-api:sha-<commit>
#        ghcr.io/<owner>/autopost-web:sha-<commit>
#        ghcr.io/<owner>/autopost-worker:sha-<commit>
#   <commit> is the FULL git commit SHA — the same value baked into the image as
#   APP_COMMIT_SHA and returned by GET /version.commit. Pass the full SHA as PREV_SHA.
#
# CONFIG — everything comes from args/environment; NO secrets are hardcoded here:
#   $1 (PREV_SHA)            full commit SHA to roll back to (primary source)
#   GHCR_OWNER               GHCR owner/org for the image refs (required unless derivable
#                            from `git remote origin`); lowercased for GHCR compatibility
#   IMAGE_PREFIX             image name prefix     (default: autopost  -> autopost-api,…)
#   TARGET_ENV               env to match in the audit log (default: production)
#   DEPLOY_AUDIT_LOG         JSONL audit log path  (default: /var/log/autopost/deploys.jsonl)
#   COMPOSE_FILE             prod compose file     (default: <repo>/docker-compose.prod.yml)
#   DOCKER_COMPOSE           compose command       (default: "docker compose")
#   API_HEALTH_URL           base API URL to poll  (default: http://localhost:3001)
#   ROLLBACK_TIMEOUT_SECONDS overall poll timeout  (default: 180)
#   ROLLBACK_POLL_INTERVAL   seconds between polls  (default: 5)
#
# -e : exit immediately on any unhandled non-zero command.
# -u : referencing an unset variable is an error.
# -o pipefail : a pipeline fails if ANY stage fails, not just the last.
set -euo pipefail

# ---------------------------------------------------------------------------
# Paths + configuration (env-driven; safe non-secret defaults only)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PREV_SHA="${1:-}"
IMAGE_PREFIX="${IMAGE_PREFIX:-autopost}"
TARGET_ENV="${TARGET_ENV:-production}"
DEPLOY_AUDIT_LOG="${DEPLOY_AUDIT_LOG:-/var/log/autopost/deploys.jsonl}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.prod.yml}"
API_HEALTH_URL="${API_HEALTH_URL:-http://localhost:3001}"
ROLLBACK_TIMEOUT_SECONDS="${ROLLBACK_TIMEOUT_SECONDS:-180}"
ROLLBACK_POLL_INTERVAL="${ROLLBACK_POLL_INTERVAL:-5}"
# Compose CLI is a multi-word command ("docker compose"); keep it splittable.
DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"

OVERRIDE_FILE=""   # set later; cleaned up by the EXIT trap

# ---------------------------------------------------------------------------
# Logging + error handling
# ---------------------------------------------------------------------------

# log MESSAGE... — timestamped line to stderr (kept off stdout so command
# substitutions that capture a resolved SHA are never polluted by log noise).
log() {
  printf '%s %s\n' "$(date +%FT%T%z)" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

on_error() {
  code=$?
  log "rollback FAILED (exit ${code}) at line ${1:-?}"
  exit "$code"
}
trap 'on_error $LINENO' ERR

# Remove the generated override file on any exit.
cleanup() {
  if [ -n "${OVERRIDE_FILE}" ] && [ -f "${OVERRIDE_FILE}" ]; then
    rm -f "${OVERRIDE_FILE}" || true
  fi
}
trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found on PATH: $1"
}

# ---------------------------------------------------------------------------
# JSON helpers — prefer jq when present, fall back to a sed extractor.
# Both operate on a SINGLE JSON object on one line (the audit log is JSONL, and
# /version is a small one-object body), so a per-line string extractor suffices.
# ---------------------------------------------------------------------------

# json_str_field FIELD JSON_LINE — echo the string value of "FIELD":"value".
# Empty output (exit 0) when the field is absent.
json_str_field() {
  field="$1"
  line="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$line" | jq -r --arg k "$field" '.[$k] // empty' 2>/dev/null || true
  else
    printf '%s' "$line" \
      | sed -n 's/.*"'"$field"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n1
  fi
}

# ---------------------------------------------------------------------------
# Resolve the currently-running commit (best-effort) so the audit-log fallback
# can avoid "rolling back" to the artifact that is already live. If the API is
# down (a common reason to roll back) this stays empty and we fall back to the
# plain last-success entry — which is why passing PREV_SHA explicitly is primary.
# ---------------------------------------------------------------------------
current_running_sha() {
  body="$(curl -fsS -m 5 "${API_HEALTH_URL}/version" 2>/dev/null || true)"
  [ -n "$body" ] || return 0
  json_str_field commit "$body"
}

# ---------------------------------------------------------------------------
# Audit-log fallback (Req 10.2) — last successful deploy for TARGET_ENV.
# Expected per-line Deploy_Audit_Record fields (written by task 12.3):
#   {"commit":"<sha>","semver":"x.y.z","env":"production","timestamp":"…","result":"success",…}
# We scan in file order and keep the LAST entry whose env matches and result=="success",
# skipping the currently-running commit when known.
# ---------------------------------------------------------------------------
resolve_from_audit_log() {
  [ -f "$DEPLOY_AUDIT_LOG" ] || return 0
  log "no PREV_SHA arg given — reading last successful deploy for env='${TARGET_ENV}' from ${DEPLOY_AUDIT_LOG}"

  current="$(current_running_sha)"
  [ -n "$current" ] && log "current running commit (from /version) = ${current}"

  found=""
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    result="$(json_str_field result "$line")"
    env="$(json_str_field env "$line")"
    commit="$(json_str_field commit "$line")"
    [ "$result" = "success" ] || continue
    [ "$env" = "$TARGET_ENV" ] || continue
    [ -n "$commit" ] || continue
    # Skip the artifact that is already live; we want the PRIOR good one.
    if [ -n "$current" ] && [ "$commit" = "$current" ]; then
      continue
    fi
    found="$commit"   # keep overwriting -> ends on the last matching entry
  done < "$DEPLOY_AUDIT_LOG"

  printf '%s' "$found"
}

# ---------------------------------------------------------------------------
# Re-deploy (Req 10.3) — generate a Compose override that pins api/web/worker to
# the GHCR sha-tagged images, then pull + recreate ONLY those three services.
# --no-build guarantees the published image is used rather than a source rebuild.
# ---------------------------------------------------------------------------
redeploy_at_sha() {
  sha="$1"
  api_ref="ghcr.io/${GHCR_OWNER}/${IMAGE_PREFIX}-api:sha-${sha}"
  web_ref="ghcr.io/${GHCR_OWNER}/${IMAGE_PREFIX}-web:sha-${sha}"
  worker_ref="ghcr.io/${GHCR_OWNER}/${IMAGE_PREFIX}-worker:sha-${sha}"

  OVERRIDE_FILE="$(mktemp "${TMPDIR:-/tmp}/autopost-rollback.XXXXXX.yml")"
  cat > "$OVERRIDE_FILE" <<EOF
# Generated by scripts/rollback.sh — pins api/web/worker to the rollback target SHA.
# Merged over docker-compose.prod.yml so the prod topology is otherwise unchanged.
services:
  api:
    image: ${api_ref}
  web:
    image: ${web_ref}
  worker:
    image: ${worker_ref}
EOF

  log "rolling back to:"
  log "  ${api_ref}"
  log "  ${web_ref}"
  log "  ${worker_ref}"

  # $DOCKER_COMPOSE is intentionally word-split ("docker compose").
  # shellcheck disable=SC2086
  log "pulling rollback images from GHCR…"
  $DOCKER_COMPOSE -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" pull api web worker

  # shellcheck disable=SC2086
  log "recreating api/web/worker at the rollback SHA (no rebuild, no migrate)…"
  $DOCKER_COMPOSE -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" up -d --no-build api web worker
}

# ---------------------------------------------------------------------------
# Verify (Req 10.3) — poll until /version.commit == PREV_SHA AND /health/ready == 200.
# ---------------------------------------------------------------------------
wait_for_rollback() {
  sha="$1"
  deadline=$(( $(date +%s) + ROLLBACK_TIMEOUT_SECONDS ))
  log "waiting for ${API_HEALTH_URL} to report commit=${sha} and /health/ready=200 (timeout ${ROLLBACK_TIMEOUT_SECONDS}s)"

  while [ "$(date +%s)" -lt "$deadline" ]; do
    version_body="$(curl -fsS -m 5 "${API_HEALTH_URL}/version" 2>/dev/null || true)"
    live_commit="$(json_str_field commit "$version_body")"
    ready_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "${API_HEALTH_URL}/health/ready" 2>/dev/null || printf '000')"

    if [ "$live_commit" = "$sha" ] && [ "$ready_code" = "200" ]; then
      log "rollback verified: /version.commit=${live_commit}, /health/ready=200"
      return 0
    fi
    log "not ready yet (commit='${live_commit:-?}', ready=${ready_code}); retrying in ${ROLLBACK_POLL_INTERVAL}s…"
    sleep "$ROLLBACK_POLL_INTERVAL"
  done

  die "timed out after ${ROLLBACK_TIMEOUT_SECONDS}s waiting for commit=${sha} and /health/ready=200"
}

# ---------------------------------------------------------------------------
# Derive GHCR_OWNER from the git remote when not supplied (e.g. github.com/<owner>/<repo>).
# ---------------------------------------------------------------------------
derive_owner_from_git() {
  command -v git >/dev/null 2>&1 || return 0
  url="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || true)"
  [ -n "$url" ] || return 0
  # Strip protocol/host + trailing .git, then take the path's first segment as the owner.
  printf '%s' "$url" \
    | sed -E 's#^(https?://|git@|ssh://git@)##; s#:#/#; s#\.git$##' \
    | awk -F/ '{ for (i=1;i<=NF;i++) if ($i ~ /github\.com|ghcr\.io/) { print $(i+1); exit } }'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  require_cmd curl
  require_cmd docker

  [ -f "$COMPOSE_FILE" ] || die "compose file not found: ${COMPOSE_FILE} (set COMPOSE_FILE)"

  # 1) Resolve PREV_SHA: explicit arg first, audit-log fallback second.
  if [ -z "$PREV_SHA" ]; then
    PREV_SHA="$(resolve_from_audit_log)"
  fi
  if [ -z "$PREV_SHA" ]; then
    die "no rollback SHA. Pass it explicitly:  $0 <PREV_SHA>
     (or ensure ${DEPLOY_AUDIT_LOG} has a successful Deploy_Audit_Record for env='${TARGET_ENV}')"
  fi
  log "rollback target commit: ${PREV_SHA}"

  # 2) Resolve GHCR owner (env first, git remote fallback) and lowercase for GHCR.
  GHCR_OWNER="${GHCR_OWNER:-$(derive_owner_from_git)}"
  [ -n "${GHCR_OWNER:-}" ] || die "GHCR_OWNER is not set and could not be derived from the git remote"
  GHCR_OWNER="$(printf '%s' "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')"
  log "GHCR owner: ${GHCR_OWNER}"

  # 3) Re-deploy at the target SHA (no destructive DB step — Req 10.4).
  redeploy_at_sha "$PREV_SHA"

  # 4) Wait until the rolled-back artifact is the one serving (Req 10.3).
  wait_for_rollback "$PREV_SHA"

  log "ROLLBACK COMPLETE — production is serving commit ${PREV_SHA}"
}

main "$@"
