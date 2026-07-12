#!/usr/bin/env bash
# Restores a database dump produced by backup-db.sh. DESTRUCTIVE: drops and
# recreates every object in the target database before loading the dump.
#
# Usage:
#   ./restore-db.sh s3://your-bucket/db/parcelmoover-db-2026-07-12T020000Z.sql.gz
#   ./restore-db.sh /path/to/local-dump.sql.gz
#
# Run this against a scratch/staging stack first to confirm dumps are
# actually restorable — don't find out during a real incident.

set -euo pipefail

SOURCE="${1:?Usage: $0 <s3://bucket/key.sql.gz | /local/path.sql.gz>}"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"

# shellcheck disable=SC1091
source .env.production

DUMP_FILE="/tmp/restore-$(date -u +%s).sql.gz"
cleanup() { rm -f "$DUMP_FILE"; }
trap cleanup EXIT

if [[ "$SOURCE" == s3://* ]]; then
  echo "==> Downloading $SOURCE"
  aws s3 cp "$SOURCE" "$DUMP_FILE" --only-show-errors
else
  DUMP_FILE="$SOURCE"
fi

read -rp "This will DROP and recreate database '${POSTGRES_DB:-parcelmoover}'. Type the database name to confirm: " CONFIRM
if [[ "$CONFIRM" != "${POSTGRES_DB:-parcelmoover}" ]]; then
  echo "Confirmation did not match — aborting." >&2
  exit 1
fi

echo "==> Dropping and recreating database..."
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-parcelmoover}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB:-parcelmoover}\";" \
  -c "CREATE DATABASE \"${POSTGRES_DB:-parcelmoover}\" OWNER \"${POSTGRES_USER:-parcelmoover}\";"

echo "==> Restoring dump..."
gunzip -c "$DUMP_FILE" | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-parcelmoover}" -d "${POSTGRES_DB:-parcelmoover}"

echo "==> Restore complete."
