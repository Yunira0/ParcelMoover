#!/usr/bin/env bash
# Run as root. Warm the inactive slot, then gracefully switch Nginx.
set -Eeuo pipefail
APP_DIR=${APP_DIR:-/var/www/express-app}
NGINX_MAIN=${NGINX_MAIN:-/etc/nginx/nginx.conf}
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-available/parcelmoover.conf}
NGINX_UPSTREAM=${NGINX_UPSTREAM:-/etc/nginx/conf.d/parcelmoover-upstream.conf}
DEPLOY_LOCK=${DEPLOY_LOCK:-/var/lock/parcelmoover-deploy.lock}
HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-60}
HEALTH_INTERVAL=${HEALTH_INTERVAL:-5}
mode=${1:-deploy}

active_port() {
  if [[ -f "$NGINX_UPSTREAM" ]]; then
    sed -n 's/.*server 127\.0\.0\.1:\([0-9]*\);.*/\1/p' "$NGINX_UPSTREAM"
  else
    echo 3000 # First upgrade from the single-container deployment.
  fi
}
service_for() {
  case "$1" in 3000) echo app;; 3001) echo app-green;; *) echo "Invalid release port: $1" >&2; return 1;; esac
}
old_port=$(active_port)
old_service=$(service_for "$old_port")
if [[ "$mode" == active-image ]]; then
  docker inspect "deploy-${old_service}-1" --format '{{.Config.Image}}'
  exit
fi
[[ "$mode" == deploy || "$mode" == rollback ]] || { echo 'Usage: deploy-app.sh [deploy|rollback|active-image]' >&2; exit 1; }
exec 9>"$DEPLOY_LOCK"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
# Re-read after acquiring the lock; another deployment may have just finished.
old_port=$(active_port)
old_service=$(service_for "$old_port")
old_image=$(docker inspect "deploy-${old_service}-1" --format '{{.Config.Image}}')
if [[ "$mode" == rollback ]]; then
  new_port=$(cat "$APP_DIR/deploy/.previous-app-port")
  [[ "$new_port" != "$old_port" ]] || { echo 'No previous release slot.' >&2; exit 1; }
else
  : "${APP_IMAGE:?Set APP_IMAGE to the immutable release tag}"
  if [[ "$old_port" == 3000 ]]; then new_port=3001; else new_port=3000; fi
fi
new_service=$(service_for "$new_port")
compose() {
  docker compose -p deploy -f "$APP_DIR/deploy/docker-compose.prod.yml" \
    --env-file "$APP_DIR/deploy/.env.production" "$@"
}
healthy() { curl -fsS --max-time 5 "http://127.0.0.1:$1/health" >/dev/null 2>&1; }
wait_ready() {
  for ((i=1; i<=HEALTH_ATTEMPTS; i++)); do
    if healthy "$new_port" && curl -fsS --max-time 5 "http://127.0.0.1:$new_port/" >/dev/null 2>&1; then
      echo "Replacement ready (attempt $i)."
      return
    fi
    sleep "$HEALTH_INTERVAL"
  done
  echo "Replacement did not become ready; current app remains active." >&2
  return 1
}
# Never recreate database/Redis or the slot currently serving traffic.
docker inspect deploy-db-1 --format '{{range .Mounts}}{{.Name}}{{println}}{{end}}' | grep -qx deploy_db-data
if [[ "$mode" == deploy ]]; then
  healthy "$old_port" || { echo 'Current app is unhealthy; investigate before switching.' >&2; exit 1; }
  compose pull "$new_service"
  compose up -d --no-deps "$new_service"
fi
wait_ready

# Keep exact live configs so any cutover failure can restore the previous route.
snapshot=$(mktemp -d)
cp "$NGINX_MAIN" "$snapshot/main"
cp "$NGINX_SITE" "$snapshot/site"
if [[ -f "$NGINX_UPSTREAM" ]]; then cp "$NGINX_UPSTREAM" "$snapshot/upstream"; fi
changed=0
cleanup() {
  result=$?
  trap - EXIT
  if ((result != 0 && changed)); then
    echo 'Cutover failed; restoring previous Nginx route.' >&2
    cp "$snapshot/main" "$NGINX_MAIN"
    cp "$snapshot/site" "$NGINX_SITE"
    if [[ -f "$snapshot/upstream" ]]; then cp "$snapshot/upstream" "$NGINX_UPSTREAM"; else rm -f "$NGINX_UPSTREAM"; fi
    nginx -t && systemctl reload nginx || echo 'Nginx restoration failed; manual intervention required.' >&2
  fi
  rm -rf "$snapshot"
  exit "$result"
}
trap cleanup EXIT
changed=1
cp "$APP_DIR/deploy/nginx/nginx.conf" "$NGINX_MAIN"
cp "$APP_DIR/deploy/nginx/parcelmoover.conf" "$NGINX_SITE"
printf 'upstream parcelmoover_app { server 127.0.0.1:%s; }\n' "$new_port" > "$NGINX_UPSTREAM.tmp"
mv "$NGINX_UPSTREAM.tmp" "$NGINX_UPSTREAM"
nginx -t
systemctl reload nginx
# Test through the actual proxy as well as directly to the candidate.
healthy "$new_port"
curl -fsS --max-time 5 -H 'Host: portal.parcelmoover.com' http://127.0.0.1/health >/dev/null
curl -fsS --max-time 5 -H 'Host: portal.parcelmoover.com' http://127.0.0.1/ >/dev/null
printf '%s\n' "$old_image" > "$APP_DIR/deploy/.last-good-image"
printf '%s\n' "$old_port" > "$APP_DIR/deploy/.previous-app-port"
changed=0
echo "Serving $new_service on port $new_port; $old_service retained for rollback and draining connections."
# Both live images are protected by their running containers.
docker image prune -a -f >/dev/null || true
