#!/usr/bin/env bash
# Pre-switch check, run as root on the host before a release takes traffic (the
# deploy workflow calls it over SSH). It reads deploy/.env.production and stops
# the deploy if a setting the release depends on is missing, so a screen never
# ships pointing at an API that is switched off. Changes nothing; safe to run by
# hand:  sudo bash /var/www/express-app/deploy/check-release-env.sh
#
# Required:
#   VAT_REGISTERS_ENABLED=true  The client shows Finance > Report > VAT registers;
#                               the API answers 404 without this.
#   COMPANY_NAME, COMPANY_PAN   Taxpayer line on every VAT register (IRD form).
#                               COMPANY_PAN is the 9-digit PAN.
# Advisory (warns only):
#   NCM_PAN, UPAYA_PAN          Supplier PAN of each 3PL on the Purchase Register.
set -Euo pipefail

APP_DIR=${APP_DIR:-/var/www/express-app}
ENV_FILE=${ENV_FILE:-$APP_DIR/deploy/.env.production}

[[ -r "$ENV_FILE" ]] || { echo "::error title=Release env check::Cannot read $ENV_FILE"; exit 1; }

# Last assignment wins, as with docker compose; surrounding quotes are dropped.
value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | sed 's/[[:space:]]*$//; s/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

failed=0
fail() { echo "::error title=Release env check::$1"; failed=1; }
warn() { echo "::warning title=Release env check::$1"; }

[[ "$(value VAT_REGISTERS_ENABLED)" == true ]] \
  || fail "Set VAT_REGISTERS_ENABLED=true in $ENV_FILE; the VAT register screens are released."
[[ -n "$(value COMPANY_NAME)" ]] \
  || fail "Set COMPANY_NAME in $ENV_FILE (taxpayer name on the VAT registers)."
[[ "$(value COMPANY_PAN)" =~ ^[0-9]{9}$ ]] \
  || fail "Set COMPANY_PAN in $ENV_FILE to the 9-digit PAN (taxpayer PAN on the VAT registers)."

for carrier in NCM UPAYA; do
  [[ -n "$(value "${carrier}_PAN")" ]] \
    || warn "${carrier}_PAN is not set; the Purchase Register shows that carrier without a PAN."
done

if ((failed)); then
  echo "Release environment incomplete; the current release keeps serving traffic." >&2
  exit 1
fi
echo "Release environment OK."
