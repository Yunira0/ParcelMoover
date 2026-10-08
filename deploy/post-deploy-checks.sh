#!/usr/bin/env bash
# Post-deploy checks, run as root on the host right after the cutover (the
# deploy workflow calls it over SSH). Each runs inside the container now serving
# traffic, against production data, and changes nothing:
#
# 1. Ledger reconcile - the books agree with the settlement statements.
# 2. Admin role report - no account's access disagrees with its department.
#
# Advisory: a failed check prints a GitHub warning and makes the script exit
# non-zero, but never touches the release. Safe to re-run by hand:
#   sudo bash /var/www/express-app/deploy/post-deploy-checks.sh
set -Euo pipefail

APP_DIR=${APP_DIR:-/var/www/express-app}
container=$(bash "$APP_DIR/deploy/deploy-app.sh" active-container)
echo "Checking the live release in $container"
failed=0

check() {
  local title=$1; shift
  echo "::group::$title"
  if docker exec "$container" "$@"; then
    echo "::endgroup::"
  else
    echo "::endgroup::"
    echo "::warning title=$title::Failed - expand the \"$title\" group in this step's log."
    failed=1
  fi
}

check "Ledger reconcile" node dist/scripts/reconcile-ledger.js
check "Admin role report" node dist/scripts/admin-role-report.js --fail-on-mismatch

exit "$failed"
