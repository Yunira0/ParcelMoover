#!/usr/bin/env bash
# Post-deploy SEO step for portal.parcelmoover.com. Run from anywhere with
# public internet (the deploy workflow runs it on the GitHub runner, after the
# cutover), so it sees the site the way a crawler does: through Cloudflare.
#
# 1. Purges the crawler-facing URLs from Cloudflare's cache when CF_API_TOKEN
#    and CF_ZONE_ID are set (token needs Zone > Cache Purge). Without that, the
#    edge can keep serving the previous robots.txt / sitemap / home page.
# 2. Verifies what is live: robots.txt and the sitemap point at the portal,
#    the home page's canonical is the portal (not www), structured data is
#    present, and nothing sends noindex.
#
# Exits non-zero if a check fails. Safe to re-run.
set -Eeuo pipefail

SITE=${SITE:-https://portal.parcelmoover.com}
# The origin the tags must name. Differs from SITE only when testing a build
# served elsewhere (e.g. SITE=http://localhost:8080).
CANONICAL=${CANONICAL:-$SITE}
ATTEMPTS=${ATTEMPTS:-6}
INTERVAL=${INTERVAL:-10}
PUBLIC_PATHS=(/ /track /apply /login /robots.txt /sitemap.xml)

purge_cloudflare() {
  if [[ -z "${CF_API_TOKEN:-}" || -z "${CF_ZONE_ID:-}" ]]; then
    echo "Cloudflare purge skipped (set CF_API_TOKEN and CF_ZONE_ID to enable)."
    return
  fi
  local files="" p
  for p in "${PUBLIC_PATHS[@]}"; do files+="\"$CANONICAL$p\","; done
  local response
  response=$(curl -fsS --max-time 20 -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "{\"files\":[${files%,}]}") || { echo "Cloudflare purge request failed." >&2; return 1; }
  grep -q '"success":true' <<<"$response" || { echo "Cloudflare purge rejected: $response" >&2; return 1; }
  echo "Cloudflare cache purged for ${#PUBLIC_PATHS[@]} public URLs."
}

failures=()
check() { # check <description> <command...>
  local description=$1; shift
  if "$@"; then echo "  ok   $description"; else echo "  FAIL $description"; failures+=("$description"); fi
}

fetch() { curl -fsS --max-time 15 "$SITE$1"; }
# Absence checks must fail when the fetch itself fails, not pass vacuously.
no_noindex() {
  local headers
  headers=$(curl -fsSI --max-time 15 "$SITE$1") || return 1
  ! grep -qi '^x-robots-tag:.*noindex' <<<"$headers"
}
no_www_urls() { [[ -n "$1" ]] && ! grep -q 'www.parcelmoover.com' <<<"$1"; }

verify() {
  local robots sitemap home
  robots=$(fetch /robots.txt) || robots=""
  sitemap=$(fetch /sitemap.xml) || sitemap=""
  home=$(fetch /) || home=""

  check "robots.txt names the portal sitemap" grep -q "^Sitemap: $CANONICAL/sitemap.xml" <<<"$robots"
  check "robots.txt allows the home page" grep -qx 'Allow: /\$' <<<"$robots"
  check "robots.txt lets crawlers load the JS bundles" grep -qx 'Allow: /assets/' <<<"$robots"
  check "sitemap lists the portal home page" grep -q "<loc>$CANONICAL/</loc>" <<<"$sitemap"
  check "sitemap has no www.parcelmoover.com URLs" no_www_urls "$sitemap"
  check "home page canonical is the portal" grep -q "<link rel=\"canonical\" href=\"$CANONICAL/\"" <<<"$home"
  check "home page og:url is the portal" grep -q "<meta property=\"og:url\" content=\"$CANONICAL/\"" <<<"$home"
  check "home page carries WebSite structured data" grep -q '"@type": "WebSite"' <<<"$home"
  check "home page is not sent with noindex" no_noindex /
}

purge_cloudflare || echo "Continuing without a purge; checks may see a stale edge copy." >&2

for ((i=1; i<=ATTEMPTS; i++)); do
  failures=()
  echo "SEO checks for $SITE (attempt $i/$ATTEMPTS):"
  verify
  ((${#failures[@]} == 0)) && break
  ((i < ATTEMPTS)) && sleep "$INTERVAL"
done

if ((${#failures[@]})); then
  echo "SEO checks failed: ${failures[*]}" >&2
  exit 1
fi

echo "SEO checks passed."
echo "One-time, by hand: add $CANONICAL as a property in Google Search Console, submit"
echo "$CANONICAL/sitemap.xml, and request indexing for $CANONICAL/ so Google re-reads the"
echo "corrected canonical sooner than its next scheduled crawl."
