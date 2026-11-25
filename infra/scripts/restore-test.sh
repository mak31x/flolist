#!/usr/bin/env bash
# Restores the newest backup into a throwaway database and checks it has the core tables.
# Run monthly on the VM (docs/deploy-oracle.md). Never touches the live database.
set -euo pipefail

FLOLIST_DIR="${FLOLIST_DIR:-/opt/flolist}"
# shellcheck disable=SC1091
set -a; . "$FLOLIST_DIR/.env"; set +a
BACKUP_DIR="${BACKUP_DIR:-$FLOLIST_DIR/backups}"
DB_USER="${POSTGRES_USER:-flolist}"
TEST_DB="flolist_restore_test"
compose=(docker compose -f "$FLOLIST_DIR/docker-compose.prod.yml" --project-directory "$FLOLIST_DIR")

latest="$(find "$BACKUP_DIR/daily" -maxdepth 1 -name 'flolist-*.dump' -type f | sort -r | head -n 1)"
[ -n "$latest" ] || { echo "[restore-test] no backups in $BACKUP_DIR/daily" >&2; exit 1; }
echo "[restore-test] restoring $latest into $TEST_DB"

psql() { "${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$@"; }
cleanup() { psql -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB" >/dev/null; }
trap cleanup EXIT

cleanup
psql -d postgres -c "CREATE DATABASE $TEST_DB" >/dev/null
"${compose[@]}" exec -T postgres pg_restore --no-owner -U "$DB_USER" -d "$TEST_DB" < "$latest"

tables="$(psql -d "$TEST_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('user', 'workspaces')")"
if [ "$tables" != "2" ]; then
  echo "[restore-test] FAILED: expected core tables, found $tables of 2" >&2
  exit 1
fi
echo "[restore-test] OK ($(psql -d "$TEST_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") tables)"
