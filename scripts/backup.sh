#!/usr/bin/env bash
#
# scripts/backup.sh — Daily Backup_Job for the Auto-Post SaaS (Req 13.1, 13.2, 13.3, 13.6).
#
# WHERE THIS RUNS: the Linux production host (a cron entry or a small cron/sidecar
# container that has pg_dump + a media-sync tool on PATH). It is NOT meant to run on
# the Windows dev box. On a POSIX filesystem make it executable once with:
#     chmod +x scripts/backup.sh
# (chmod is a no-op on a Windows checkout; the executable bit + this shebang are what
# matter on the Linux host. Git preserves the +x mode bit when committed from Linux.)
#
# WHAT IT DOES, in order:
#   1. pg_dump the database, piped through gzip, into
#        ${BACKUP_DIR}/pg/autopost-<YYYY-MM-DD-HHMM>.sql.gz                  (Req 13.1)
#   2. Mirror the Object_Storage media bucket into ${BACKUP_DIR}/media/      (Req 13.2)
#        - Option A: MinIO client `mc mirror`            (self-hosted MinIO default)
#        - Option B: `aws s3 sync` with --endpoint-url   (AWS S3 / Cloudflare R2)
#        The option is chosen at runtime by which tool is on PATH.
#   3. Prune backups older than RETENTION_DAYS in BOTH pg/ and media/        (Req 13.3)
#   4. On ANY step failure: record it to the log and raise an Alert          (Req 13.6)
#        - Alert = POST to ${BACKUP_ALERT_WEBHOOK_URL} when set (Slack/Telegram-style
#          {"text": ...} JSON); otherwise a clear stderr message + non-zero exit.
#
# CONFIG — everything comes from the environment; NO secrets are hardcoded here:
#   BACKUP_DIR              backup root            (default: /backups)
#   RETENTION_DAYS          days to keep, >= 7     (default: 7; values < 7 are clamped to 7)
#   DATABASE_URL            postgres conn string   (or supply the standard PG* vars below)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  alternative to DATABASE_URL (libpq env)
#   S3_BUCKET_NAME          media bucket           (required for media backup)
#   S3_ENDPOINT             object-storage endpoint
#   S3_ACCESS_KEY           object-storage access key
#   S3_SECRET_KEY           object-storage secret key
#   S3_REGION               region for aws path    (default: us-east-1)
#   BACKUP_ALERT_WEBHOOK_URL   optional alert webhook (Slack incoming webhook / Telegram /
#                              any endpoint accepting a JSON {"text": "..."} body)
#   BACKUP_LOG_FILE         log file path          (default: ${BACKUP_DIR}/backup.log)

# -E  : ERR trap is inherited by functions/subshells so failures anywhere are caught.
# -e  : exit immediately on any unhandled non-zero command.
# -u  : referencing an unset variable is an error.
# -o pipefail : a pipeline (e.g. pg_dump | gzip) fails if ANY stage fails, not just the last.
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Configuration (env-driven; safe defaults only for non-secret values)
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/backups}"
PG_DIR="${BACKUP_DIR}/pg"
MEDIA_DIR="${BACKUP_DIR}/media"
LOG_FILE="${BACKUP_LOG_FILE:-${BACKUP_DIR}/backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CURRENT_STEP="startup"

# ---------------------------------------------------------------------------
# Logging + alerting helpers
# ---------------------------------------------------------------------------

# log MESSAGE... — timestamped line to stderr always, and appended to the log
# file when its directory exists (resilient if called before BACKUP_DIR is made).
log() {
  line="$(date +%FT%T%z) $*"
  printf '%s\n' "$line" >&2
  if [ -n "${LOG_FILE:-}" ] && [ -d "$(dirname "$LOG_FILE")" ]; then
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

# json_escape STRING — minimal escaping so a message is safe inside a JSON string
# literal: backslash, double-quote, and any newlines collapsed to spaces.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/ /g'
}

# raise_alert MESSAGE — Req 13.6: record the failure and notify an Operator.
# Posts to BACKUP_ALERT_WEBHOOK_URL when set (provider-agnostic {"text": ...}
# body, compatible with Slack incoming webhooks and similar); otherwise the
# stderr log line + the script's non-zero exit are the alert.
raise_alert() {
  msg="$1"
  log "ALERT: $msg"
  if [ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ]; then
    if command -v curl >/dev/null 2>&1; then
      payload="$(printf '{"text":"[autopost-backup] %s"}' "$(json_escape "$msg")")"
      curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
        -d "$payload" "$BACKUP_ALERT_WEBHOOK_URL" >/dev/null 2>&1 \
        || log "WARN: alert webhook delivery failed"
    else
      log "WARN: curl not found; cannot deliver alert webhook"
    fi
  fi
}

# ERR trap — any unhandled command failure lands here, raises an Alert, and exits
# non-zero so the cron run is marked failed (Req 13.6).
on_error() {
  code=$?
  raise_alert "backup FAILED (exit ${code}) at line ${1:-?} during step='${CURRENT_STEP}'"
  exit "$code"
}
trap 'on_error $LINENO' ERR

# require_env VAR_NAME — alert + exit if a required variable is unset/empty.
require_env() {
  name="$1"
  if [ -z "${!name:-}" ]; then
    raise_alert "missing required environment variable: ${name} (step='${CURRENT_STEP}')"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Retention prune (Req 13.3) — kept deliberately isolated and single-purpose so
# the retention boundary can be reasoned about and tested directly.
#
# prune_older_than DIR DAYS  ->  delete files in DIR strictly older than DAYS.
#
# BOUNDARY SEMANTICS of `find -mtime +N` (this is the whole prune decision):
#   find computes each file's age = floor((now - mtime) / 24h) as an integer
#   number of whole 24-hour periods, and `-mtime +N` matches when that integer
#   is STRICTLY GREATER THAN N. Therefore a file is DELETED iff it is more than
#   N full days old, and a file aged 0..N whole days is KEPT. With the default
#   N = RETENTION_DAYS = 7 this keeps every backup for at least 7 days and only
#   removes those strictly older — exactly Req 13.3 ("retain >= 7 days, remove
#   backups older than the retention period").
# ---------------------------------------------------------------------------
prune_older_than() {
  dir="$1"
  days="$2"
  [ -d "$dir" ] || return 0
  # Single find with -mtime +N is the entire "delete iff older than N days" rule.
  find "$dir" -type f -mtime +"$days" -delete
}

# ---------------------------------------------------------------------------
# Backup steps
# ---------------------------------------------------------------------------

# Step 1 — Postgres logical dump, gzip-compressed (Req 13.1).
# Dumps to a .partial file first and renames on success so a failed/aborted run
# never leaves a truncated file that looks like a valid backup.
backup_postgres() {
  CURRENT_STEP="pg_dump"
  mkdir -p "$PG_DIR"

  if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGDATABASE:-}" ]; then
    raise_alert "no database connection config: set DATABASE_URL or the PG* libpq env vars"
    exit 1
  fi

  out="${PG_DIR}/autopost-$(date +%F-%H%M).sql.gz"
  tmp="${out}.partial"

  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump "$DATABASE_URL" | gzip -c > "$tmp"
  else
    # Uses libpq env vars: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
    pg_dump | gzip -c > "$tmp"
  fi

  mv -f "$tmp" "$out"
  log "postgres backup written: ${out}"
}

# Step 2 — Mirror Object_Storage media (Req 13.2). Tool is gated on availability:
# prefer `mc` (MinIO), fall back to `aws` (S3 / R2). If neither is present the
# media step cannot run, which is a backup failure -> Alert.
backup_media() {
  CURRENT_STEP="media_mirror"
  mkdir -p "$MEDIA_DIR"
  require_env S3_BUCKET_NAME

  if command -v mc >/dev/null 2>&1; then
    # --- Option A: MinIO client `mc mirror` (self-hosted MinIO default) ---
    require_env S3_ENDPOINT
    require_env S3_ACCESS_KEY
    require_env S3_SECRET_KEY
    alias="autopostbackup"
    # Credentials are passed to mc at runtime from env; nothing is persisted here
    # beyond mc's own alias config on the backup host.
    mc alias set "$alias" "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
    # --overwrite refreshes changed objects; we intentionally do NOT pass --remove
    # so objects deleted upstream are retained in the backup copy.
    mc mirror --overwrite "${alias}/${S3_BUCKET_NAME}" "$MEDIA_DIR"
    log "media mirrored via mc: ${alias}/${S3_BUCKET_NAME} -> ${MEDIA_DIR}"
  elif command -v aws >/dev/null 2>&1; then
    # --- Option B: aws CLI `s3 sync` (AWS S3 / Cloudflare R2) ---
    require_env S3_ENDPOINT
    require_env S3_ACCESS_KEY
    require_env S3_SECRET_KEY
    # Map the project's S3_* vars onto the AWS SDK's expected env, scoped to this
    # command only (not exported into the rest of the script's environment).
    AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
    AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
      aws s3 sync "s3://${S3_BUCKET_NAME}" "$MEDIA_DIR" --endpoint-url "$S3_ENDPOINT"
    log "media synced via aws: s3://${S3_BUCKET_NAME} -> ${MEDIA_DIR}"
  else
    raise_alert "media backup tool missing: neither 'mc' nor 'aws' found on PATH"
    exit 1
  fi
}

# Step 3 — Prune old backups in both directories (Req 13.3).
# NOTE on media/: because `mc mirror`/`aws s3 sync` only rewrite CHANGED objects,
# an object's local mtime reflects when it was last copied; long-unchanged media
# can therefore age past the window. The retention floor (>= 7 days) keeps a
# generous margin; operators wanting an exact point-in-time media snapshot should
# back media into dated archives instead of a live mirror.
prune_backups() {
  CURRENT_STEP="prune"
  prune_older_than "$PG_DIR" "$RETENTION_DAYS"
  prune_older_than "$MEDIA_DIR" "$RETENTION_DAYS"
  log "pruned backups older than ${RETENTION_DAYS} day(s) in ${PG_DIR} and ${MEDIA_DIR}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  mkdir -p "$BACKUP_DIR"

  # Enforce the retention floor of 7 days (Req 13.3).
  case "$RETENTION_DAYS" in
    ''|*[!0-9]*)
      raise_alert "RETENTION_DAYS must be a non-negative integer, got '${RETENTION_DAYS}'"
      exit 1
      ;;
  esac
  if [ "$RETENTION_DAYS" -lt 7 ]; then
    log "WARN: RETENTION_DAYS=${RETENTION_DAYS} is below the 7-day minimum; clamping to 7 (Req 13.3)"
    RETENTION_DAYS=7
  fi

  log "backup starting: BACKUP_DIR=${BACKUP_DIR} RETENTION_DAYS=${RETENTION_DAYS}"
  backup_postgres
  backup_media
  prune_backups
  CURRENT_STEP="done"
  log "backup completed successfully"
}

main "$@"
