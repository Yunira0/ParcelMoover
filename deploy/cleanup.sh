#!/usr/bin/env bash
# cleanup.sh — prune Docker build cache and dangling images after deploy.
# Run this on the server after a successful `docker compose up -d`.
set -euo pipefail

echo "==> Pruning stopped containers..."
docker container prune -f

echo "==> Pruning dangling images..."
docker image prune -f

echo "==> Pruning unused build cache (older than 24h)..."
docker builder prune -f --filter "until=24h"

echo "==> Docker disk usage:"
docker system df

echo "Done."
