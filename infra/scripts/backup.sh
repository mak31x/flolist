#!/usr/bin/env bash
# Nightly Postgres backup (cron on the VM, as the deploy user; see docs/deploy-oracle.md).
# Writes a custom-format dump (already compressed, so no extra gzip) to $BACKUP_DIR/daily and, on
# Sundays, hard-links it into $BACKUP_DIR/weekly. Keeps BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY.
set -euo pipefail

FLOLIST_DIR="${FLOLIST_DIR:-/opt/flolist}"
# shellcheck disable=SC1091
set -a; . "$FLOLIST_DIR/.env"; set +a

BACKUP_DIR="${BACKUP_DIR:-$FLOLIST_DIR/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
DB_USER="${POSTGRES_USER:-flolist}"
DB_NAME="${POSTGRES_DB:-flolist}"
# Overridable so the script can be exercised without Docker.
DUMP_CMD="${BACKUP_DUMP_CMD:-docker compose -f $FLOLIST_DIR/docker-compose.prod.yml --project-directory $FLOLIST_DIR exec -T postgres pg_dump -Fc -Z 6 -U $DB_USER -d $DB_NAME}"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/daily/flolist-$stamp.dump"

# Write to a temp name first so a failed dump never counts as a backup.
$DUMP_CMD > "$file.partial"
if [ ! -s "$file.partial" ]; then
  rm -f "$file.partial"
  echo "[backup] dump is empty" >&2
  exit 1
fi
mv "$file.partial" "$file"
chmod 600 "$file"

if [ "$(date -u +%u)" = "7" ] || [ "${BACKUP_FORCE_WEEKLY:-}" = "1" ]; then
  ln -f "$file" "$BACKUP_DIR/weekly/$(basename "$file")"
fi

# prune <dir> <keep>: delete all but the newest <keep> dumps (names sort by time).
prune() {
  find "$1" -maxdepth 1 -name 'flolist-*.dump' -type f | sort -r | tail -n +"$(($2 + 1))" | xargs -r rm -f
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
