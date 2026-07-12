#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu EC2 instance that will host ParcelMoover.
# Run as: ssh onto the box, then `sudo bash ec2-setup.sh`
#
# What this does:
#   1. Installs Docker + the Compose plugin, enables Docker on boot
#   2. Installs Nginx + Certbot for TLS termination
#   3. Installs awscli, for the DB/uploads backup scripts (deploy/backup-*.sh)
#   4. Adds a swapfile (small instances OOM during `npm ci` / `vite build` otherwise)
#   5. Locks the firewall down to SSH/HTTP/HTTPS only
#
# What it does NOT do (do these yourself, in order, after this script finishes):
#   - Copy the repo onto the box (git clone, or scp a tarball)
#   - Create /opt/parcelmoover/.env.production with real production secrets
#     (copy server/.env.example as the list of required keys, fill in real values)
#   - Edit deploy/nginx/parcelmoover.conf: replace YOUR_DOMAIN_HERE with your real domain
#   - Point your domain's DNS A record at this instance's public IP
#   - Run certbot to issue the TLS cert (instructions printed at the end)
#   - Build/pull the app image and `docker compose -f deploy/docker-compose.prod.yml up -d`
#   - Set up automated DB/uploads backups (instructions printed at the end)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash ec2-setup.sh" >&2
  exit 1
fi

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing Docker"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker

echo "==> Installing Nginx + Certbot"
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Installing awscli (for deploy/backup-db.sh and backup-uploads.sh)"
apt-get install -y awscli

echo "==> Adding a 2G swapfile (protects small instances during image builds)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
else
  echo "    /swapfile already exists, skipping"
fi

echo "==> Configuring firewall (ufw): allow SSH, HTTP, HTTPS only"
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Adding the current sudo user to the docker group (log out/in to take effect)"
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "$SUDO_USER"
fi

cat <<'EOF'

==============================================================================
Done. Next steps (do these manually):

1. Get the app onto this box, e.g.:
     git clone <your-repo-url> /opt/parcelmoover
     cd /opt/parcelmoover

2. Create the production secrets file (never commit this):
     cp server/.env.example /opt/parcelmoover/deploy/.env.production
     # edit it with real JWT_SECRET / CSRF_SECRET / SMTP / NCM production values,
     # and add: POSTGRES_PASSWORD=<a-strong-password>

3. Build the image for THIS box's CPU architecture (check with `uname -m`):
     docker build -t parcelmoover:latest .
   If you built it on an Apple Silicon Mac and this box is x86_64 (most EC2
   default instance types), rebuild here on the box, or cross-build with:
     docker buildx build --platform linux/amd64 -t parcelmoover:latest .

4. Point your domain's DNS A record at this instance's public IP, then edit
   deploy/nginx/parcelmoover.conf, replacing YOUR_DOMAIN_HERE with your real
   domain. Copy it into place and reload Nginx:
     cp deploy/nginx/parcelmoover.conf /etc/nginx/sites-available/parcelmoover.conf
     ln -s /etc/nginx/sites-available/parcelmoover.conf /etc/nginx/sites-enabled/
     rm -f /etc/nginx/sites-enabled/default
     nginx -t && systemctl reload nginx

5. Issue the TLS certificate (certbot edits the Nginx config in place):
     certbot --nginx -d YOUR_DOMAIN_HERE

6. Start the stack:
     cd /opt/parcelmoover
     docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d

7. Verify:
     curl https://YOUR_DOMAIN_HERE/health

8. Set up DB + uploads backups (deploy/backup-db.sh, deploy/backup-uploads.sh):
     - Create an S3 bucket for backups (versioning + default encryption on,
       block all public access), then apply the lifecycle policy so old
       backups expire automatically instead of costing money forever:
         aws s3api put-bucket-lifecycle-configuration \
           --bucket YOUR_BACKUP_BUCKET --lifecycle-configuration file://deploy/s3-lifecycle.json
     - Prefer attaching an IAM role to this EC2 instance with s3:PutObject
       scoped to that bucket, instead of static AWS keys on the box.
     - Add to /opt/parcelmoover/deploy/.env.production:
         BACKUP_S3_BUCKET=YOUR_BACKUP_BUCKET
     - Install the cron jobs:
         crontab -e
         0 2 * * *   /opt/parcelmoover/deploy/backup-db.sh      >> /var/log/parcelmoover-backup.log 2>&1
         0 3 * * 0   /opt/parcelmoover/deploy/backup-uploads.sh >> /var/log/parcelmoover-backup.log 2>&1
     - Test the restore path once against a scratch stack, don't wait for a
       real incident to find out (deploy/restore-db.sh).
==============================================================================
EOF
