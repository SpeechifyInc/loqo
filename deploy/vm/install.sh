#!/usr/bin/env bash
# Installs or upgrades loqo on an Ubuntu host from the checkout it lives in: Postgres and the app
# under docker compose, nginx with a Let's Encrypt certificate in front. Upgrade: git pull, re-run.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
: "${LOQO_DOMAIN:?Set LOQO_DOMAIN to the public hostname; its A record must point at this host.}"
ENV_FILE="${LOQO_ENV_FILE:-/etc/loqo.env}"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found: copy .env.example there and fill it in." >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
if ! command -v docker >/dev/null || ! command -v certbot >/dev/null; then
  apt-get -q -o DPkg::Lock::Timeout=300 update
  apt-get -q -o DPkg::Lock::Timeout=300 install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# It goes into DATABASE_URL verbatim, so it must not need URL encoding.
[[ "${POSTGRES_PASSWORD:-}" =~ ^[A-Za-z0-9_-]+$ ]] \
  || { echo "Set POSTGRES_PASSWORD in $ENV_FILE to a URL-safe value, e.g. \`openssl rand -hex 24\`." >&2; exit 1; }
export APP_URL="https://$LOQO_DOMAIN"
# Host sides of docker-compose.yml's port mappings: loopback only, so nginx is the way in.
export PORT=127.0.0.1:3000 POSTGRES_PORT=127.0.0.1:5433
export LOQO_DATA_DIR="${LOQO_DATA_DIR:-/var/lib/loqo/postgres}"
mkdir -p "$LOQO_DATA_DIR"

docker compose -f "$ROOT/docker-compose.yml" -f "$HERE/docker-compose.vm.yml" up -d --build --remove-orphans
docker image prune -f >/dev/null

sed "s/__DOMAIN__/$LOQO_DOMAIN/g" "$HERE/nginx.conf" > /etc/nginx/sites-available/loqo
ln -sf /etc/nginx/sites-available/loqo /etc/nginx/sites-enabled/loqo
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload-or-restart nginx

contact=(--register-unsafely-without-email)
if [ -n "${LOQO_EMAIL:-}" ]; then contact=(-m "$LOQO_EMAIL"); fi
certbot --nginx -d "$LOQO_DOMAIN" --non-interactive --agree-tos "${contact[@]}" --redirect --keep-until-expiring -q

echo "loqo is up at $APP_URL (OAuth redirect URI: $APP_URL/api/auth/google/callback)"
