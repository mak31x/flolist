#!/usr/bin/env bash
# Runs on the VM, called by the deploy job over SSH: deploy.sh <image-tag>
# The web build must already be in web-releases/<image-tag>/. Migrations run first and are never
# rolled back, so they must stay backward compatible with the previous release (expand/contract).
# On a failed health check the previous image tag and web release are restored.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
FLOLIST_DIR="${FLOLIST_DIR:-/opt/flolist}"
cd "$FLOLIST_DIR"

compose() { docker compose -f docker-compose.prod.yml --project-directory "$FLOLIST_DIR" "$@"; }
# shellcheck disable=SC1091
HEALTH_URL="http://$(set -a; . ./.env; echo "${CADDY_BIND_HTTP:-127.0.0.1:8088}")"
PREV_TAG="$(cat .image-tag 2>/dev/null || true)"

[ -f "web-releases/$TAG/index.html" ] || { echo "[deploy] web-releases/$TAG is missing" >&2; exit 1; }

switch_web() { ln -sfn "$1" web-releases/current.tmp && mv -Tf web-releases/current.tmp web-releases/current; }

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL/api/health" >/dev/null && curl -fsS "$HEALTH_URL/" | grep -q '<div id="root"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start() {
  export IMAGE_TAG="$1"
  compose up -d --wait --remove-orphans
  # Bind-mounted config changes don't recreate the container, so reload Caddy explicitly.
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
}

echo "[deploy] $PREV_TAG -> $TAG"
export IMAGE_TAG="$TAG"
compose pull --quiet
compose run --rm migrate

switch_web "$TAG"
if start "$TAG" && healthy; then
  echo "$TAG" > .image-tag
  echo "[deploy] $TAG is live"
else
  echo "[deploy] health check failed for $TAG" >&2
  if [ -n "$PREV_TAG" ]; then
    echo "[deploy] rolling back to $PREV_TAG" >&2
    switch_web "$PREV_TAG"
    start "$PREV_TAG" || true
    healthy && echo "[deploy] rolled back to $PREV_TAG" >&2
  fi
  exit 1
fi

# Keep the five newest web releases (plus whatever `current` points to) and drop dangling images.
current="$(readlink web-releases/current)"
find web-releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -rn | tail -n +6 | cut -d' ' -f2 |
  while read -r old; do [ "$old" = "$current" ] || rm -rf "web-releases/$old"; done
docker image prune -f --filter "until=168h" >/dev/null
