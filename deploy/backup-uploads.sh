#!/usr/bin/env bash
# Weekly backup of the uploads-data volume (encrypted KYC/registration
# documents — see server/src/lib/documentEncryption.ts). Runs less often
# than backup-db.sh since this data changes far less frequently and the
# archive is bigger; tighten the schedule if upload volume grows.
#
# Reads the volume directly via a throwaway container rather than through
# the app container, so it doesn't depend on the app being healthy.
#
# Install as a cron job, e.g. weekly at 3am Sunday:
#   crontab -e
#   0 3 * * 0 /opt/parcelmoover/deploy/backup-uploads.sh >> /var/log/parcelmoover-backup.log 2>&1

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"

# shellcheck disable=SC1091
source .env.production

: "${BACKUP_S3_BUCKET:?Set BACKUP_S3_BUCKET in deploy/.env.production}"

TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
ARCHIVE_NAME="parcelmoover-uploads-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"

cleanup() { rm -f "$ARCHIVE_PATH"; }
trap cleanup EXIT

echo "==> [$(date -u)] Archiving uploads-data volume..."
docker run --rm \
  -v deploy_uploads-data:/data:ro \
  -v /tmp:/backup \
  alpine \
  tar czf "/backup/${ARCHIVE_NAME}" -C /data .

echo "==> Uploading to s3://${BACKUP_S3_BUCKET}/uploads/${ARCHIVE_NAME}"
aws s3 cp "$ARCHIVE_PATH" "s3://${BACKUP_S3_BUCKET}/uploads/${ARCHIVE_NAME}" --only-show-errors

echo "==> [$(date -u)] Backup complete: ${ARCHIVE_NAME}"
