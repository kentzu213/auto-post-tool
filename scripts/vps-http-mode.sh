#!/usr/bin/env bash
#
# vps-http-mode.sh — Switch an already-bootstrapped stack to PLAIN HTTP so the app
# is reachable immediately for evaluation when Let's Encrypt cannot issue a cert
# for the sslip.io hostname (rate limit / shared-domain issues).
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/kentzu213/auto-post-tool/master/scripts/vps-http-mode.sh)
#
# WARNING: HTTP is NOT encrypted. This is for single-operator evaluation only.
# Do NOT open to real customers in this mode (the workspace-authorization launch
# gate still applies). Re-run vps-bootstrap.sh later to restore HTTPS once the
# cert situation is resolved (e.g. a real domain).
#
# What it does (idempotent):
#   1. Recompute sslip.io hostnames from the public IP.
#   2. Rewrite .env so the browser-facing API URL + CORS use http:// (not https).
#   3. Write a Caddyfile with `auto_https off` serving plain HTTP on :80.
#   4. Rebuild ONLY the web image (Next.js bakes NEXT_PUBLIC_API_URL at build) and
#      recreate web + caddy.
#   5. Smoke check over HTTP and print the link.

set -euo pipefail
DEPLOY_DIR="/opt/autopost"
COMPOSE="docker compose -f docker-compose.prod.yml"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$DEPLOY_DIR/.git" ] || die "$DEPLOY_DIR not found. Run vps-bootstrap.sh first."
cd "$DEPLOY_DIR"
git fetch --all --prune -q && git reset --hard origin/master -q

PUBLIC_IP="$(curl -fsSL https://api.ipify.org || curl -fsSL https://ifconfig.me)"
[ -n "$PUBLIC_IP" ] || die "cannot determine public IP"
IP_DASHED="${PUBLIC_IP//./-}"
APP_HOST="app-${IP_DASHED}.sslip.io"
API_HOST="api-${IP_DASHED}.sslip.io"
log "Web http://${APP_HOST}  |  API http://${API_HOST}"

[ -f "$DEPLOY_DIR/.env" ] || die ".env missing — run vps-bootstrap.sh first."

# 2. Point browser-facing URLs at http:// (replace or append the keys).
log "Rewriting .env URLs to http:// …"
sed -i '/^NEXT_PUBLIC_API_URL=/d;/^CORS_ORIGINS=/d;/^APP_HOST=/d;/^API_HOST=/d' "$DEPLOY_DIR/.env"
{
  echo "APP_HOST=${APP_HOST}"
  echo "API_HOST=${API_HOST}"
  echo "NEXT_PUBLIC_API_URL=http://${API_HOST}"
  echo "CORS_ORIGINS=http://${APP_HOST}"
} >> "$DEPLOY_DIR/.env"
chmod 600 "$DEPLOY_DIR/.env"

# 3. Caddyfile: plain HTTP, no auto-HTTPS, no redirect.
log "Writing HTTP-only Caddyfile …"
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

# shellcheck disable=SC1090
set -a; . "$DEPLOY_DIR/.env"; set +a

# 4. Rebuild web (API URL is baked at build time) + recreate web & caddy.
log "Rebuilding web image with http API URL (this takes a few minutes) …"
$COMPOSE build web
log "Recreating web + caddy + api …"
$COMPOSE up -d --no-deps api web caddy

# 5. Smoke check over HTTP.
log "Smoke check over HTTP …"
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
