#!/usr/bin/env bash
#
# vps-pull-mode.sh — Bring the stack up on the VPS by PULLING prebuilt images
# from GHCR instead of building on the VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/kentzu213/auto-post-tool/master/scripts/vps-pull-mode.sh -o run.sh
#   bash run.sh
#
# WHY: building 3 Node/Next images on a small VPS runs it out of RAM and takes
# 20+ minutes per attempt. The GitHub Actions CI already builds, scans, and
# publishes ghcr.io/<owner>/autopost-{api,web,worker}:latest. This script just
# pulls those, so the VPS never compiles anything. Bring-up is ~2-3 minutes.
#
# HTTP-only (evaluation) mode: Caddy serves plain HTTP on :80 for the sslip.io
# hostnames. NOT encrypted — single-operator evaluation only.
#
# Idempotent: re-running re-pulls :latest and recreates the stack.

set -euo pipefail
REPO_URL="https://github.com/kentzu213/auto-post-tool.git"
DEPLOY_DIR="/opt/autopost"
BRANCH="master"
REGISTRY_OWNER="kentzu213"   # GHCR namespace (lowercase) holding the published images
IMAGE_TAG="latest"           # CI publishes :latest on every master push
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (paste into the Vultr Console as root)."

# ---------------------------------------------------------------------------
# 1. Base packages + Docker (only if missing)
# ---------------------------------------------------------------------------
log "Ensuring git + Docker…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y git curl ca-certificates openssl >/dev/null 2>&1 || true
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1b. Reclaim disk BEFORE pulling. The earlier build-on-VPS attempts left tens of
# GB of Docker build cache + dangling images in /var/lib/docker, which filled the
# disk ("no space left on device" during layer extraction). On a pull-only host
# the build cache is 100% garbage, so prune it aggressively. Safe: it never
# touches named volumes (postgres/redis/minio data live in volumes, kept by
# default; we do NOT pass --volumes).
# ---------------------------------------------------------------------------
log "Reclaiming disk (pruning old build cache + dangling images)…"
df -h / | awk 'NR==1||/\//{print "   "$0}'
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
docker container prune -f >/dev/null 2>&1 || true
docker network prune -f >/dev/null 2>&1 || true
log "Disk after prune:"
df -h / | awk 'NR==1||/\//{print "   "$0}'

# ---------------------------------------------------------------------------
# 2. Clone / update the repo (we still need the compose files + Caddyfile + .env)
# ---------------------------------------------------------------------------
if [ -d "$DEPLOY_DIR/.git" ]; then
  log "Updating checkout at $DEPLOY_DIR…"
  git -C "$DEPLOY_DIR" fetch --all --prune -q
  git -C "$DEPLOY_DIR" checkout "$BRANCH" -q
  git -C "$DEPLOY_DIR" reset --hard "origin/$BRANCH" -q
else
  log "Cloning into $DEPLOY_DIR…"
  git clone --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR" -q
fi
cd "$DEPLOY_DIR"

# ---------------------------------------------------------------------------
# 3. Public IP → sslip.io hostnames
# ---------------------------------------------------------------------------
PUBLIC_IP="$(curl -fsSL https://api.ipify.org || curl -fsSL https://ifconfig.me)"
[ -n "$PUBLIC_IP" ] || die "cannot determine public IP"
IP_DASHED="${PUBLIC_IP//./-}"
APP_HOST="app-${IP_DASHED}.sslip.io"
API_HOST="api-${IP_DASHED}.sslip.io"
log "Web http://${APP_HOST}  |  API http://${API_HOST}"

# ---------------------------------------------------------------------------
# 4. Generate .env (first run only; preserved afterwards)
# ---------------------------------------------------------------------------
ENV_FILE="$DEPLOY_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  log ".env exists — preserving secrets; refreshing public URLs to http://…"
  sed -i '/^NEXT_PUBLIC_API_URL=/d;/^CORS_ORIGINS=/d;/^APP_HOST=/d;/^API_HOST=/d' "$ENV_FILE"
  {
    echo "APP_HOST=${APP_HOST}"
    echo "API_HOST=${API_HOST}"
    echo "NEXT_PUBLIC_API_URL=http://${API_HOST}"
    echo "CORS_ORIGINS=http://${APP_HOST}"
  } >> "$ENV_FILE"
else
  log "Generating .env with strong random secrets…"
  PG_PW="$(openssl rand -hex 24)"
  MINIO_PW="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 48)"
  JWT_REFRESH="$(openssl rand -hex 48)"
  ENC_KEY="$(openssl rand -hex 32)"
  BULL_PW="$(openssl rand -hex 16)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3001
POSTGRES_USER=autopost
POSTGRES_PASSWORD=${PG_PW}
POSTGRES_DB=autopost
DATABASE_URL=postgresql://autopost:${PG_PW}@postgres:5432/autopost?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=autopost
S3_SECRET_KEY=${MINIO_PW}
S3_BUCKET_NAME=autopost-media
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
MINIO_ROOT_USER=autopost
MINIO_ROOT_PASSWORD=${MINIO_PW}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH}
ENCRYPTION_KEY=${ENC_KEY}
OAUTH_STATE_SECRET=${JWT_SECRET}
APP_HOST=${APP_HOST}
API_HOST=${API_HOST}
NEXT_PUBLIC_API_URL=http://${API_HOST}
CORS_ORIGINS=http://${APP_HOST}
BULL_BOARD_USER=admin
BULL_BOARD_PASSWORD=${BULL_PW}
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
EOF
  log "Bull Board password: ${BULL_PW}"
fi
chmod 600 "$ENV_FILE"

# Artifact selector for docker-compose.deploy.yml (image: ghcr.io/<owner>/...:<tag>)
grep -q '^REGISTRY_OWNER=' "$ENV_FILE" || echo "REGISTRY_OWNER=${REGISTRY_OWNER}" >> "$ENV_FILE"
grep -q '^IMAGE_TAG=' "$ENV_FILE"      || echo "IMAGE_TAG=${IMAGE_TAG}" >> "$ENV_FILE"
sed -i "s|^REGISTRY_OWNER=.*|REGISTRY_OWNER=${REGISTRY_OWNER}|; s|^IMAGE_TAG=.*|IMAGE_TAG=${IMAGE_TAG}|" "$ENV_FILE"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# 5. HTTP-only Caddyfile
# ---------------------------------------------------------------------------
log "Writing HTTP-only Caddyfile…"
cat > "$DEPLOY_DIR/Caddyfile" <<EOF
{
	auto_https off
}

http://${APP_HOST} {
	encode gzip zstd
	reverse_proxy web:3000 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
	}
}

http://${API_HOST} {
	encode gzip zstd
	reverse_proxy api:3001 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
	}
}
EOF

# ---------------------------------------------------------------------------
# 6. Reclaim disk space, then pull prebuilt images (NO build on the VPS)
# ---------------------------------------------------------------------------
export REGISTRY_OWNER IMAGE_TAG

# ROOT CAUSE of earlier "no space left on device": the failed `docker compose
# build` attempts left tens of GB of BuildKit cache + dangling images on the
# disk, so containerd had no room to EXTRACT the pulled layers. Reclaim it now.
# These are safe: builder cache is disposable, and prune only removes STOPPED
# containers / UNREFERENCED images — running containers and named volumes (incl.
# postgres_prod_data) are never touched.
log "Disk usage BEFORE cleanup:"; df -h / | tail -1
log "Reclaiming disk: BuildKit cache + dangling images + stopped containers…"
docker builder prune -af  >/dev/null 2>&1 || true
docker image prune -af    >/dev/null 2>&1 || true
docker container prune -f >/dev/null 2>&1 || true
log "Disk usage AFTER cleanup:"; df -h / | tail -1

log "Pulling prebuilt app images from GHCR (autopost-api/web/worker:${IMAGE_TAG})…"
$COMPOSE pull api web worker migrate || die "pull failed — are the GHCR packages public? See note at the end."

log "Pulling data-service images (postgres/redis/minio/caddy)…"
$COMPOSE pull postgres redis minio caddy || true

log "Starting data services…"
$COMPOSE up -d --no-build postgres redis minio

log "Waiting for postgres to be healthy…"
for i in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then break; fi
  sleep 2
done

log "Applying migrations (prisma migrate deploy)…"
$COMPOSE run --rm migrate || warn "migrate returned non-zero (check logs)"

log "Recreating full stack from pulled images (no build)…"
$COMPOSE up -d --no-build

# ---------------------------------------------------------------------------
# 7. Smoke check over HTTP
# ---------------------------------------------------------------------------
log "Smoke check…"
READY=""
for i in $(seq 1 20); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "http://${API_HOST}/health/ready" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then READY=1; break; fi
  sleep 3
done

echo
echo "=================================================================="
if [ -n "$READY" ]; then
  echo " ✅ Izzi Auto Post is UP over HTTP (evaluation mode, NOT encrypted)."
else
  echo " ⚠️  API not ready yet — check: $COMPOSE ps ; $COMPOSE logs --tail=40 api web caddy"
fi
echo "    Web : http://${APP_HOST}"
echo "    API : http://${API_HOST}/health/ready"
echo "    Ver : http://${API_HOST}/version"
echo "=================================================================="
curl -fsS "http://${API_HOST}/version" 2>/dev/null && echo
$COMPOSE ps

# ---------------------------------------------------------------------------
# NOTE: if `pull` failed with "denied"/"unauthorized", the GHCR packages are
# private. Make them public once (GitHub → your profile → Packages →
# autopost-api/web/worker → Package settings → Change visibility → Public),
# or run `docker login ghcr.io` on the VPS with a PAT that has read:packages.
# ---------------------------------------------------------------------------
