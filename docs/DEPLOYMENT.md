# ParcelMoover — Deployment Runbook

Everything needed to deploy, back up, roll back, and rebuild production from scratch.

## Architecture at a glance

```
Your Mac (~/parcelmoover-beta, git repo — source of truth)
   │  rsync (git archive HEAD → staging → /opt/parcelmoover, no --delete)
   ▼
EC2 ubuntu@51.21.199.242  (domain: 51-21-199-242.sslip.io)
   /opt/parcelmoover          ← synced source, used only at build time (no .git!)
   docker build → parcelmoover:latest
   docker compose (deploy/docker-compose.prod.yml):
     deploy-app-1    127.0.0.1:3000 (nginx-proxied, never public)
     deploy-db-1     postgres 16, volume deploy_db-data   (external, REAL DATA)
     deploy-redis-1  redis 7
   nginx: TLS on 80/443 → proxy to 127.0.0.1:3000
   Rider PWA: static at /var/www/rider-pwa (nginx-served, NOT in Docker)
```

SSH access:

```bash
ssh -i ~/Documents/dep/paecelmoover.pem ubuntu@51.21.199.242
# filename really is "paecelmoover.pem"; chmod 400 it if perms error
```

## One-time setup (already done on the live box — needed only for a rebuild)

1. **Provision EC2**: Ubuntu LTS, t3.small+, 20 GB gp3, key pair,
   security group inbound 22/80/443 only, Elastic IP associated.
2. **Bootstrap**: copy `deploy/ec2-setup.sh` to the box, `sudo bash ec2-setup.sh`
   (installs Docker+Compose, nginx+certbot, awscli, 2G swap, ufw 22/80/443).
3. **Code**: rsync a `git archive HEAD` export to `/opt/parcelmoover`
   (host has no git — never `git clone`/`git pull` there).
4. **Secrets**: create `/opt/parcelmoover/deploy/.env.production` from
   `server/.env.example` + `POSTGRES_PASSWORD=...`. Never committed, never in
   the image (.gitignore + .dockerignore block all `.env*` except `.env.example`).
5. **Volumes** (fresh box only): `docker volume create deploy_db-data deploy_uploads-data`
   — the prod compose declares them `external:` so it will not create them.
6. **Nginx + TLS**: fill domain into `deploy/nginx/parcelmoover.conf`, copy to
   `/etc/nginx/sites-available/`, symlink to sites-enabled, remove default site,
   `nginx -t && systemctl reload nginx`, then `certbot --nginx -d DOMAIN`.
7. **First launch**:
   ```bash
   cd /opt/parcelmoover
   sudo docker build -t parcelmoover:latest .
   sudo docker compose -f deploy/docker-compose.prod.yml \
     --env-file deploy/.env.production up -d
   curl https://DOMAIN/health
   ```
8. **Backups**: private S3 bucket (versioning+encryption, no public access),
   lifecycle from `deploy/s3-lifecycle.json`, EC2 IAM role with s3:PutObject
   (`deploy/backup-iam-policy.json`), `BACKUP_S3_BUCKET=` in .env.production,
   cron: nightly 2am `deploy/backup-db.sh`, weekly Sun 3am `deploy/backup-uploads.sh`.
   Test `deploy/restore-db.sh` against a scratch stack once.

## Routine deploy

### Option A — CI/CD (`.github/workflows/deployment.yml`)

Needs GitHub secrets `EC2_SSH_KEY` (pem contents) and `EC2_HOST` (IP).
Push to `main` (or trigger manually from the Actions tab) and the pipeline runs:

1. CI: server build (prisma generate + tsc) + tests against service
   postgres/redis, client build.
2. Pre-deploy safety net: fresh DB dump to S3 via `backup-db.sh`, then tags
   the running image `parcelmoover:previous` (the rollback target).
3. rsync `git archive HEAD` → `/opt/parcelmoover-staging/` → live dir
   (no `--delete`, so `.env.production` and host-only files survive).
4. `docker build` + `compose up -d`, then asserts `deploy-db-1` still mounts
   `deploy_db-data` (guards the 2026-07-14 fresh-volume incident).
5. Health check `127.0.0.1:3000/health`.
6. **Auto-rollback** if restart or health check fails: retags
   `previous → latest`, `up -d --force-recreate app`, re-checks health.
   Code rolls back automatically; the DATABASE does not — if a bad migration
   ran, restore the pre-deploy S3 dump with `deploy/restore-db.sh` manually.

### Option B — manual from the Mac

```bash
cd ~/parcelmoover-beta
TMP=$(mktemp -d) && git archive HEAD | tar -x -C "$TMP"
rsync -az -e "ssh -i ~/Documents/dep/paecelmoover.pem" \
  "$TMP"/ ubuntu@51.21.199.242:/opt/parcelmoover-staging/
ssh -i ~/Documents/dep/paecelmoover.pem ubuntu@51.21.199.242 '
  rsync -a /opt/parcelmoover-staging/ /opt/parcelmoover/ &&
  cd /opt/parcelmoover &&
  sudo docker build -t parcelmoover:latest . &&
  sudo docker compose -f deploy/docker-compose.prod.yml \
    --env-file deploy/.env.production up -d'
```

### Rider PWA (separate — no Docker involved)

```bash
cd rider && npm run build
rsync -az -e "ssh -i ~/Documents/dep/paecelmoover.pem" \
  dist/ ubuntu@51.21.199.242:/var/www/rider-pwa/
```

## Never do

- `git pull` on the host (no .git there) — always rsync.
- rsync with `--delete` into `/opt/parcelmoover` — kills `.env.production`.
- Rename/recreate `deploy_db-data` / `deploy_uploads-data` volumes — a compose
  file that stops pointing at them silently boots a FRESH EMPTY database.
  After any compose change: `docker inspect deploy-db-1` must show `deploy_db-data`.
- Build the image on the Mac and copy it over — Apple Silicon arch mismatch;
  always build on the box (or `buildx --platform linux/amd64`).

## Env files

- Mac: `server/.env` (dev secrets, loaded by dotenv from `server/`).
- EC2: `/opt/parcelmoover/deploy/.env.production` — used twice by compose:
  `--env-file` substitutes `${POSTGRES_PASSWORD}` in the YAML, `env_file:`
  injects vars into the app container. No `.env` file exists inside containers.
- Committed template: `server/.env.example` only.
