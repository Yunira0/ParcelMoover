#!/usr/bin/env bash
# Pre-switch check, run as root on the host before a release takes traffic (the
# deploy workflow calls it over SSH). It reads deploy/.env.production and stops
# the deploy if a setting the release depends on is missing, so a screen never
# ships pointing at an API that is switched off. Changes nothing; safe to run by
# hand:  sudo bash /var/www/express-app/deploy/check-release-env.sh
#
# Advisory (warns only) while the VAT registers are hidden
# (client/src/constants/features.ts); make VAT_REGISTERS_ENABLED a fail() again
# in the same change that shows them:
#   VAT_REGISTERS_ENABLED=true  The VAT register API answers 404 without this.
#   COMPANY_NAME, COMPANY_PAN   Taxpayer line on every VAT register (IRD form);
#                               left blank, the register prints a dotted line.
#                               A COMPANY_PAN that is set must be 9 digits.
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
  || warn "VAT_REGISTERS_ENABLED is not true; set it before the VAT register screens are shown."
[[ -n "$(value COMPANY_NAME)" ]] \
  || warn "COMPANY_NAME is not set; the VAT registers print a blank taxpayer name."
pan=$(value COMPANY_PAN)
if [[ -z "$pan" ]]; then
  warn "COMPANY_PAN is not set; the VAT registers print a blank taxpayer PAN."
elif [[ ! "$pan" =~ ^[0-9]{9}$ ]]; then
  # A wrong PAN on a tax register is worse than a blank one.
  fail "COMPANY_PAN in $ENV_FILE must be the 9-digit PAN."
fi

for carrier in NCM UPAYA; do
  [[ -n "$(value "${carrier}_PAN")" ]] \
    || warn "${carrier}_PAN is not set; the Purchase Register shows that carrier without a PAN."
done

if ((failed)); then
  echo "Release environment incomplete; the current release keeps serving traffic." >&2
  exit 1
fi
echo "Release environment OK."
