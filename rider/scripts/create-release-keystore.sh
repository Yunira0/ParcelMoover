#!/usr/bin/env bash
# One-time: create the PM Rider release signing key.
#
#   bash rider/scripts/create-release-keystore.sh [output.jks]
#
# EVERY future release must be signed with this exact key. If it is lost,
# Android will refuse to update installed apps and every rider has to
# uninstall (losing their login) and reinstall. Back it up somewhere offline
# (password manager / encrypted drive) before doing anything else.
set -euo pipefail

OUT="${1:-$HOME/.parcelmoover/pm-rider-release.jks}"
ALIAS="pm-rider"

if [ -e "$OUT" ]; then
  echo "✖ $OUT already exists - refusing to overwrite a signing key." >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"

read -r -s -p "New keystore password (min 12 chars): " PW; echo
read -r -s -p "Repeat password: " PW2; echo
if [ "$PW" != "$PW2" ]; then echo "✖ Passwords differ" >&2; exit 1; fi
if [ "${#PW}" -lt 12 ]; then echo "✖ Use at least 12 characters" >&2; exit 1; fi

# PKCS12 keystores use one password for both the store and the key.
keytool -genkeypair -v \
  -keystore "$OUT" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=PM Rider, O=ParcelMoover, C=NP" \
  -storepass "$PW" -keypass "$PW" >/dev/null 2>&1
chmod 600 "$OUT"

FINGERPRINT=$(keytool -list -v -keystore "$OUT" -storepass "$PW" -alias "$ALIAS" \
  | awk -F': ' '/SHA256:/ {print $2; exit}' | tr -d ':' | tr 'A-F' 'a-f')

cat <<MSG

✔ Created $OUT  (alias: $ALIAS)
  Certificate SHA-256: $FINGERPRINT

Next steps:
  1. Back up $OUT and the password offline NOW.
  2. Add the GitHub secrets/variable (repo Settings → Secrets and variables → Actions),
     or with the gh CLI from the repo root:

       base64 -i "$OUT" | gh secret set RIDER_KEYSTORE_BASE64
       gh secret set RIDER_KEYSTORE_PASSWORD     # paste the password
       gh variable set RIDER_SIGNING_CERT_SHA256 --body "$FINGERPRINT"

  3. Optional, for local release builds: create rider/android/keystore.properties
       storeFile=$OUT
       storePassword=<password>
       keyAlias=$ALIAS
       keyPassword=<password>
MSG
