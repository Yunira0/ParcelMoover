#!/usr/bin/env bash
# Nightly Postgres backup: dumps the parcelmoover DB from the running `db`
# container, gzips it, and uploads it to S3.
#
# Runs as an OS-level cron job, deliberately NOT from inside the Node
# process (see server/src/index.ts's setInterval sweeps) — if the app
# container is crash-looping or mid-deploy, an in-process timer wouldn't
# run either, which is exactly when you'd want a backup to still happen.
#
# Requires on the host: docker, awscli, and either an EC2 instance IAM role
# with s3:PutObject on BACKUP_S3_BUCKET (preferred — no long-lived keys on
# the box) or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY exported some other way.
#
# Install as a cron job, e.g. nightly at 2am server time:
#   crontab -e
#   0 2 * * * /opt/parcelmoover/deploy/backup-db.sh >> /var/log/parcelmoover-backup.log 2>&1

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"

# shellcheck disable=SC1091
source .env.production

: "${BACKUP_S3_BUCKET:?Set BACKUP_S3_BUCKET in deploy/.env.production}"

TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DUMP_FILE="/tmp/parcelmoover-db-${TIMESTAMP}.sql.gz"

cleanup() { rm -f "$DUMP_FILE"; }
trap cleanup EXIT

echo "==> [$(date -u)] Dumping database..."
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-parcelmoover}" "${POSTGRES_DB:-parcelmoover}" \
  | gzip > "$DUMP_FILE"

echo "==> Uploading to s3://${BACKUP_S3_BUCKET}/db/$(basename "$DUMP_FILE")"
aws s3 cp "$DUMP_FILE" "s3://${BACKUP_S3_BUCKET}/db/$(basename "$DUMP_FILE")" --only-show-errors

echo "==> [$(date -u)] Backup complete: $(basename "$DUMP_FILE")"
