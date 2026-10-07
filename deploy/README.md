# Production deployment

The GitHub workflow builds and tests the release, snapshots the database, and
runs `sudo env APP_IMAGE=ghcr.io/yunira0/parcelmoover:<commit> bash
/var/www/express-app/deploy/deploy-app.sh` on EC2.

The existing `app` slot listens on localhost:3000; `app-green` listens on
localhost:3001. Both share the existing database, Redis, and upload volume.
The inactive slot is pulled and recreated with `--no-deps`; the current slot
continues serving throughout migrations and startup repairs. Health and HTML
checks must pass before Nginx is validated and gracefully reloaded. Failed
cutovers restore the exact previous Nginx configuration. A host lock serializes
manual deployments with workflow deployments. Do not use unrestricted
`docker compose up -d` to deploy a release.

The previous app remains running for connection draining and rollback:

```sh
sudo bash /var/www/express-app/deploy/deploy-app.sh active-image
sudo bash /var/www/express-app/deploy/deploy-app.sh rollback
```

Rollback checks the retained slot before switching; it does not restart it.
The next deployment replaces that inactive slot. Keep migrations and startup
repairs compatible with both the current and replacement versions. An app
rollback does not undo database changes; pre-deploy dumps are stored in
`/var/backups/parcelmoover/`. This protects release handover on one EC2 host;
it does not provide redundancy for a host, database, or billing failure.

Default pool size is 30 connections per slot, leaving Postgres headroom for
migration/admin connections. Overrides must account for both slots. Prisma
explicitly disposes its externally supplied pg pool on disconnect, so startup
CLI scripts exit immediately after their work rather than waiting 30 seconds.

Production defaults `SKIP_STARTUP_DATA_REPAIRS=false` for both app slots, so
the `--once` startup repairs (branch-deposit repair, carrier collection
backfill, ledger resyncs including the per-vendor 2005 re-post) run on deploy.
Each runs at most once per database. Set the variable to `true` to skip them
for a deploy; schema/index migrations and the read-only diagnostic run either way.

After the switch, the workflow runs `deploy/post-deploy-seo.sh` from the
runner: it purges the public pages, `robots.txt` and `sitemap.xml` from
Cloudflare (needs the `CF_API_TOKEN` and `CF_ZONE_ID` secrets; skipped
without them) and checks that the live canonical, sitemap and robots rules
name `portal.parcelmoover.com`. The step is advisory and never rolls back a
release. Run it by hand the same way: `bash deploy/post-deploy-seo.sh`.

Run handover/failure tests with `python3 -m unittest discover -s deploy/tests -v`.
The server database cleanup test uses the migrated CI database and the compiled
server. Run `npm run build` before server tests.
